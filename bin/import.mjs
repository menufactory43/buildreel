// node import.mjs <transcript.jsonl>
// Relit l'historique d'une session Claude Code et sort, en JSON, chaque Edit, Write et Bash
// avec son heure, sa sortie et son statut. Le mod se charge de les classer.
import { readFileSync } from 'node:fs'

const [transcript] = process.argv.slice(2)
const uses = new Map()
const events = []

const text = content =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map(b => (b.type === 'text' ? b.text : '')).join('\n')
      : ''

for (const line of readFileSync(transcript, 'utf8').split('\n')) {
  if (!line.trim()) continue
  let row
  try {
    row = JSON.parse(line)
  } catch {
    continue
  }
  const content = row.message?.content
  if (!Array.isArray(content)) continue
  for (const block of content) {
    if (block.type === 'tool_use' && ['Edit', 'Write', 'Bash'].includes(block.name)) {
      uses.set(block.id, block)
    } else if (block.type === 'tool_result' && uses.has(block.tool_use_id)) {
      const use = uses.get(block.tool_use_id)
      events.push({
        at: Date.parse(row.timestamp),
        tool: use.name,
        file: use.input.file_path,
        command: use.input.command,
        output: text(block.content).slice(0, 4000),
        isError: block.is_error === true,
      })
    }
  }
}
process.stdout.write(JSON.stringify(events))
