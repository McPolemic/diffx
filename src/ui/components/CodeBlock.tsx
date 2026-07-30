import { useEffect, useState } from 'react'
import { codeToHtml, bundledLanguages } from 'shiki'

interface CodeBlockProps {
  code: string
  lang?: string
}

// Shiki is already in the tree for the diff itself, so fenced blocks are highlighted with
// the same themes the diff uses. Highlighting is async, so the plain code renders first
// and is swapped once it resolves; an unknown or missing language just stays plain.
export function CodeBlock({ code, lang }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    const language = lang && lang in bundledLanguages ? lang : null
    if (!language) {
      setHtml(null)
      return
    }

    let cancelled = false
    codeToHtml(code, {
      lang: language,
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    })
      .then((result) => {
        if (!cancelled) setHtml(result)
      })
      .catch(() => {
        if (!cancelled) setHtml(null)
      })

    return () => {
      cancelled = true
    }
  }, [code, lang])

  if (html) {
    // Shiki escapes the code it tokenises, so this renders the source as text either way.
    return <div className="md-code" dangerouslySetInnerHTML={{ __html: html }} />
  }

  return (
    <pre>
      <code>{code}</code>
    </pre>
  )
}
