// T3.7 .scadaproj:序列化 / 解析往返、坏文件拒绝、不含密码。
import { describe, expect, it } from 'vitest'
import { registerBuiltins, type PageConfig } from '@grid/scada-renderer'
import {
  createProject,
  parseProject,
  ProjectParseError,
  projectFileName,
  serializeProject,
} from '../src/project/scadaproj'

registerBuiltins()

const page: PageConfig = {
  schemaVersion: 1,
  template: 'overview-a',
  title: '总览',
  widgets: [
    {
      id: 'w-g1',
      type: 'line',
      slot: 'g1',
      bindings: {
        series: [
          {
            mode: 'ts-history',
            entity: { type: 'DEVICE', id: 'x', name: 'SSP1_GP1_IED1' },
            keys: ['P'],
            window: '24h',
          },
        ],
      },
    },
  ],
}

describe('.scadaproj', () => {
  it('往返:序列化再解析得到同样内容;字段顺序固定;不含密码', () => {
    const p = createProject({
      connection: { base: '/tbm', user: 'tenant@thingsboard.org' },
      siteName: 'xrs-mirror-test',
      pages: [page],
      published: { 'xrs-mirror-test-总览': { assetId: 'a1', version: 3, at: 1, by: 'yy' } },
    })
    const text = serializeProject({ ...p, connection: { ...p.connection, pass: 'secret' } as never })
    expect(text).not.toContain('secret')
    expect(Object.keys(JSON.parse(text))).toEqual([
      'version',
      'connection',
      'siteName',
      'metaSnapshot',
      'pages',
      'rules',
      'published',
    ])
    expect(parseProject(text)).toEqual(p)
    expect(projectFileName(p)).toBe('xrs-mirror-test.scadaproj')
    expect(projectFileName(createProject())).toBe('project.scadaproj')
  })

  it('坏文件:非 JSON、version 不对、页面不合 schema、published 缺字段、含密码 都被拒绝并列出问题', () => {
    expect(() => parseProject('{')).toThrow(ProjectParseError)
    const bad = {
      version: 2,
      connection: { base: '/tbm', user: 'u', password: 'p' },
      siteName: 5,
      pages: [{ ...page, widgets: [{ ...page.widgets[0], bindings: { series: 'nope' } }] }, { hello: 1 }],
      published: { x: { version: '1' } },
    }
    try {
      parseProject(JSON.stringify(bad))
      throw new Error('should throw')
    } catch (e) {
      const err = e as ProjectParseError
      expect(err).toBeInstanceOf(ProjectParseError)
      expect(err.issues.join('\n')).toMatch(/version 必须是 1/)
      expect(err.issues.join('\n')).toMatch(/siteName/)
      expect(err.issues.join('\n')).toMatch(/不能含密码/)
      expect(err.issues.join('\n')).toMatch(/pages\[0\].*不符合 schema/)
      expect(err.issues.join('\n')).toMatch(/pages\[1\] 不是 PageConfig/)
      expect(err.issues.join('\n')).toMatch(/published\[x\]/)
    }
  })
})
