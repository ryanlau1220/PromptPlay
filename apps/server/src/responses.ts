import type { ChatMessage, ChatOptions } from './provider'
import { RequestError } from './errors'

type RecordValue = Record<string, unknown>
function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RequestError('Unsupported Responses input', 400)
  return value as RecordValue
}
function only(value: RecordValue, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new RequestError('Unsupported Responses input', 400)
}
function text(value: unknown, max = 100000): string {
  if (typeof value !== 'string' || value.length > max) throw new RequestError('Unsupported Responses input', 400)
  return value
}
/** Translate the explicitly supported, stateless Responses input items into chat messages. */
export function responsesInput(input: unknown, instructions?: string): ChatMessage[] {
  const messages: ChatMessage[] = instructions ? [{ role: 'system', content: instructions }] : []
  if (typeof input === 'string') {
    if (!input) throw new RequestError('Unsupported Responses input', 400)
    messages.push({ role: 'user', content: text(input) })
    return messages
  }
  if (!Array.isArray(input) || input.length < 1 || input.length > 32)
    throw new RequestError('Unsupported Responses input', 400)
  for (const value of input) {
    const item = record(value)
    if (item.type === 'function_call') {
      only(item, ['type', 'id', 'call_id', 'name', 'arguments', 'status'])
      const call = {
        id: text(item.call_id, 256),
        type: 'function',
        function: { name: text(item.name, 256), arguments: text(item.arguments) },
      }
      const previous = messages.at(-1)
      if (previous?.role === 'assistant' && previous.content === null && Array.isArray(previous.tool_calls))
        previous.tool_calls.push(call)
      else messages.push({ role: 'assistant', content: null, tool_calls: [call] })
    } else if (item.type === 'function_call_output') {
      only(item, ['type', 'id', 'call_id', 'output', 'status'])
      messages.push({ role: 'tool', tool_call_id: text(item.call_id, 256), content: text(item.output) })
    } else {
      only(item, ['type', 'role', 'content', 'id', 'status'])
      if (item.type !== undefined && item.type !== 'message') throw new RequestError('Unsupported Responses input', 400)
      if (!['system', 'developer', 'user', 'assistant'].includes(String(item.role)))
        throw new RequestError('Unsupported Responses input', 400)
      let content: string
      if (typeof item.content === 'string') content = text(item.content)
      else if (Array.isArray(item.content) && item.content.length > 0 && item.content.length <= 64)
        content = item.content
          .map((part) => {
            const p = record(part)
            only(p, ['type', 'text', 'annotations'])
            if (p.type !== 'input_text' && p.type !== 'output_text')
              throw new RequestError('Unsupported Responses input', 400)
            return text(p.text)
          })
          .join('')
      else throw new RequestError('Unsupported Responses input', 400)
      messages.push({ role: item.role === 'developer' ? 'system' : (item.role as ChatMessage['role']), content })
    }
  }
  return messages
}
export function responsesTools(tools: unknown, choice: unknown, parallel: unknown): ChatOptions {
  const options: ChatOptions = {}
  if (tools !== undefined) {
    if (!Array.isArray(tools) || tools.length > 128) throw new RequestError('Unsupported Responses tools', 400)
    options.tools = tools.map((value) => {
      const tool = record(value)
      only(tool, ['type', 'name', 'description', 'parameters', 'strict'])
      if (
        tool.type !== 'function' ||
        (tool.strict !== undefined && tool.strict !== null && typeof tool.strict !== 'boolean') ||
        (tool.parameters !== undefined &&
          tool.parameters !== null &&
          (typeof tool.parameters !== 'object' || Array.isArray(tool.parameters)))
      )
        throw new RequestError('Unsupported Responses tools', 400)
      const name = text(tool.name, 256)
      if (!name) throw new RequestError('Unsupported Responses tools', 400)
      return {
        type: 'function',
        function: {
          name,
          ...(tool.description !== undefined && tool.description !== null
            ? { description: text(tool.description) }
            : {}),
          parameters: tool.parameters ?? {},
          ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
        },
      }
    })
  }
  if (choice !== undefined) {
    if (typeof choice === 'string' && ['auto', 'none', 'required'].includes(choice)) options.tool_choice = choice
    else {
      const c = record(choice)
      only(c, ['type', 'name'])
      if (c.type !== 'function') throw new RequestError('Unsupported Responses tool choice', 400)
      options.tool_choice = { type: 'function', function: { name: text(c.name, 256) } }
    }
  }
  if (parallel !== undefined) {
    if (typeof parallel !== 'boolean') throw new RequestError('Unsupported Responses tool choice', 400)
    options.parallel_tool_calls = parallel
  }
  return options
}

/** Convert metered Chat Completions SSE into stateless Responses SSE. */
export function responsesStream(source: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
  const reader = source.getReader(),
    encoder = new TextEncoder(),
    decoder = new TextDecoder()
  const id = `resp_${crypto.randomUUID()}`,
    messageId = `msg_${crypto.randomUUID()}`,
    created = Math.floor(Date.now() / 1000)
  const tools = new Map<number, { id: string; name: string; arguments: string }>()
  let textValue = '',
    buffer = '',
    sequence = 0,
    started = false,
    ended = false,
    finish = '',
    counts: { input_tokens: number; output_tokens: number; total_tokens: number } | undefined
  const output: RecordValue[] = []
  let readerReleased = false
  const releaseReader = () => {
    if (!readerReleased) {
      reader.releaseLock()
      readerReleased = true
    }
  }
  const response = (status: string) => ({
    id,
    object: 'response',
    created_at: created,
    status,
    model,
    output: status === 'in_progress' ? [] : output,
    error: null,
    incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
    ...(counts ? { usage: counts } : {}),
  })
  async function* events(): AsyncGenerator<Uint8Array> {
    const emit = (type: string, fields: RecordValue) =>
      encoder.encode(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...fields })}\n\n`)
    const message = () => ({ id: messageId, type: 'message', status: 'in_progress', role: 'assistant', content: [] })
    try {
      yield emit('response.created', { response: response('in_progress') })
      yield emit('response.in_progress', { response: response('in_progress') })
      while (true) {
        const chunk = await reader.read()
        buffer += decoder.decode(chunk.value, { stream: !chunk.done })
        if (buffer.length > 1_000_000) throw new Error('Stream frame too large')
        let end = buffer.indexOf('\n\n')
        while (end >= 0) {
          const frame = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          end = buffer.indexOf('\n\n')
          const payload = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n')
          if (!payload) continue
          if (payload === '[DONE]') {
            ended = true
            continue
          }
          const data = JSON.parse(payload) as {
            choices?: Array<{
              delta?: {
                role?: string
                content?: string | null
                tool_calls?: Array<{
                  index: number
                  id?: string
                  type?: string
                  function?: { name?: string; arguments?: string }
                }>
              }
              finish_reason?: string | null
            }>
            usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
          }
          if (data.usage)
            counts = {
              input_tokens: data.usage.prompt_tokens,
              output_tokens: data.usage.completion_tokens,
              total_tokens: data.usage.prompt_tokens + data.usage.completion_tokens,
            }
          const choice = data.choices?.[0]
          if (!choice) continue
          if (choice.finish_reason) finish = choice.finish_reason
          const delta = choice.delta
          if (!delta) continue
          if (delta.content) {
            if (typeof delta.content !== 'string' || textValue.length + delta.content.length > 1_000_000)
              throw new Error('Invalid text delta')
            if (!started) {
              started = true
              yield emit('response.output_item.added', { response_id: id, output_index: 0, item: message() })
              yield emit('response.content_part.added', {
                response_id: id,
                item_id: messageId,
                output_index: 0,
                content_index: 0,
                part: { type: 'output_text', text: '', annotations: [] },
              })
            }
            textValue += delta.content
            yield emit('response.output_text.delta', {
              response_id: id,
              item_id: messageId,
              output_index: 0,
              content_index: 0,
              delta: delta.content,
            })
          }
          for (const call of delta.tool_calls ?? []) {
            if (
              !Number.isInteger(call.index) ||
              call.index < 0 ||
              call.index >= 128 ||
              (call.type && call.type !== 'function')
            )
              throw new Error('Invalid function delta')
            const current = tools.get(call.index) ?? { id: '', name: '', arguments: '' }
            current.id += call.id ?? ''
            current.name += call.function?.name ?? ''
            current.arguments += call.function?.arguments ?? ''
            if (current.id.length > 256 || current.name.length > 256 || current.arguments.length > 256000)
              throw new Error('Function delta too large')
            tools.set(call.index, current)
          }
        }
        if (chunk.done) break
      }
      if (!ended || !counts || !['stop', 'length', 'tool_calls'].includes(finish))
        throw new Error('Incomplete provider stream')
      if (started) {
        const part = { type: 'output_text', text: textValue, annotations: [] },
          item = {
            id: messageId,
            type: 'message',
            status: finish === 'length' ? 'incomplete' : 'completed',
            role: 'assistant',
            content: [part],
          }
        yield emit('response.output_text.done', {
          response_id: id,
          item_id: messageId,
          output_index: 0,
          content_index: 0,
          text: textValue,
        })
        yield emit('response.content_part.done', {
          response_id: id,
          item_id: messageId,
          output_index: 0,
          content_index: 0,
          part,
        })
        yield emit('response.output_item.done', { response_id: id, output_index: 0, item })
        output.push(item)
      }
      for (const [index, call] of [...tools.entries()].sort((a, b) => a[0] - b[0])) {
        if (!call.id || !call.name) throw new Error('Invalid function call')
        const outputIndex = output.length,
          itemId = `fc_${id.slice(5)}_${index}`,
          item = {
            id: itemId,
            type: 'function_call',
            status: 'completed',
            call_id: call.id,
            name: call.name,
            arguments: call.arguments,
          }
        yield emit('response.output_item.added', {
          response_id: id,
          output_index: outputIndex,
          item: { ...item, status: 'in_progress', arguments: '' },
        })
        if (call.arguments)
          yield emit('response.function_call_arguments.delta', {
            response_id: id,
            item_id: itemId,
            output_index: outputIndex,
            delta: call.arguments,
          })
        yield emit('response.function_call_arguments.done', {
          response_id: id,
          item_id: itemId,
          output_index: outputIndex,
          arguments: call.arguments,
        })
        yield emit('response.output_item.done', { response_id: id, output_index: outputIndex, item })
        output.push(item)
      }
      if (!output.length) throw new Error('Empty provider stream')
      const status = finish === 'length' ? 'incomplete' : 'completed'
      yield emit(status === 'completed' ? 'response.completed' : 'response.incomplete', { response: response(status) })
    } catch (error) {
      await reader.cancel().catch(() => {})
      throw error
    } finally {
      releaseReader()
    }
  }
  const iterator = events()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await iterator.next()
        if (result.done) controller.close()
        else controller.enqueue(result.value)
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel() {
      await reader.cancel().catch(() => {})
      await iterator.return(undefined).catch(() => {})
      releaseReader()
    },
  })
}
