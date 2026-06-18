import MarkdownIt from 'markdown-it'

const markdownRenderer = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
})

const codeFencePattern = /```/g

export const normalizeStreamingMarkdown = (content: string, isStreaming: boolean) => {
  if (!isStreaming) {
    return content
  }

  const fenceCount = content.match(codeFencePattern)?.length ?? 0

  if (fenceCount % 2 === 0) {
    return content
  }

  const separator = content.endsWith('\n') ? '' : '\n'
  return `${content}${separator}\`\`\``
}

export const renderMarkdown = (content: string) => {
  return markdownRenderer.render(content)
}

export const renderStreamingMarkdown = (content: string, isStreaming: boolean) => {
  return renderMarkdown(normalizeStreamingMarkdown(content, isStreaming))
}
