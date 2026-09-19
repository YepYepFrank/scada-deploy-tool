import { it } from 'vitest'
import { useEditorState } from '../src/editor/useEditorState'
import { applySldContent } from '../src/editor/sld-integration'
import { bigContent } from './sld-integration-fixtures'

it('bench', () => {
  for (const n of [100, 300, 600]) {
    const content = bigContent(n)
    const ed = useEditorState({ schemaVersion: 1, template: 'grid-3x3', title: 't', widgets: [] } as never)
    ed.update(d => {
      d.widgets.push({ id: 'w1', slot: 'a', type: 'sld', props: {}, bindings: {} } as never)
    })
    const size = JSON.stringify(content).length
    const times: number[] = []
    for (let i = 0; i < 60; i++) {
      const t0 = performance.now()
      ed.patchWidget('w1', w => applySldContent(w, 'doc', content))
      times.push(performance.now() - t0)
    }
    const t1 = performance.now()
    ed.undo()
    const tu = performance.now() - t1
    const small: number[] = []
    for (let i = 0; i < 20; i++) {
      const t = performance.now()
      ed.update(d => (d.title = 't' + i))
      small.push(performance.now() - t)
    }
    times.sort((a, b) => a - b)
    small.sort((a, b) => a - b)
    console.log(
      `nodes=${content.doc.nodes.length} size=${(size / 1024).toFixed(0)}KB commit median=${times[30]!.toFixed(2)}ms max=${times[59]!.toFixed(2)}ms undo=${tu.toFixed(2)}ms smallEdit median=${small[10]!.toFixed(2)} max=${small[19]!.toFixed(2)}`
    )
  }
})
