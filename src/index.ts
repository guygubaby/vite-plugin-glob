import type { ModuleNode, Plugin, ResolvedConfig, ViteDevServer } from 'vite'
import { isMatch } from 'micromatch'
import type { ParsedImportGlob, PluginOptions } from '../types'
import { transform } from './transform'

export default function(options: PluginOptions = {}): Plugin {
  let server: ViteDevServer | undefined
  let config: ResolvedConfig
  const map = new Map<string, string[][]>()

  function updateMap(id: string, info: ParsedImportGlob[]) {
    const allGlobs = info.map(i => i.globsResolved)
    map.set(id, allGlobs)
    // add those allGlobs to the watcher
    server?.watcher.add(allGlobs.flatMap(i => i.filter(i => i[0] !== '!')))
  }

  function getAffectedModules(file: string) {
    const modules: ModuleNode[] = []
    for (const [id, allGlobs] of map) {
      if (allGlobs.some(glob => isMatch(file, glob)))
        modules.push(...(server?.moduleGraph.getModulesByFile(id) || []))
    }
    return modules
  }

  return {
    name: 'vite-plugin-glob',
    config() {
      return {
        server: {
          watch: {
            disableGlobbing: false,
          },
        },
      }
    },
    configResolved(_config) {
      config = _config
    },
    buildStart() {
      map.clear()
    },
    configureServer(_server) {
      server = _server

      // file unlink won't be handled by handleHotUpdate,
      // so we do the update manually
      server.watcher.on('unlink', (file: string) => {
        const modules = getAffectedModules(file)
        _server.ws.send({
          type: 'update',
          updates: modules.map((mod) => {
            _server.moduleGraph.invalidateModule(mod)
            return {
              acceptedPath: mod.id!,
              path: mod.id!,
              timestamp: Date.now(),
              type: 'js-update',
            }
          }),
        })
      })
    },
    handleHotUpdate({ file }) {
      const modules = getAffectedModules(file)
      if (modules.length)
        return modules
    },
    async transform(code, id) {
      const result = await transform(code, id, config.root, options)
      if (result) {
        updateMap(id, result.matches)
        return {
          code: result.s.toString(),
          map: result.s.generateMap(),
        }
      }
    },
  }
}
