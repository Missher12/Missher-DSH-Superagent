/** Installed host plugins and genuinely exposed member tools; inspection never invokes a tool. */
import { usePoll } from './api.ts'
import { Button, Icon } from './controls.tsx'
import { useAction, usePanel } from './provider.tsx'
import { LoadState, SessionButton, When } from './widgets.tsx'

export function LocalPlugins() {
  const { t, call, inspectPlugins } = usePanel()
  const { data, error, reload } = usePoll(async () => {
    if (!inspectPlugins) throw new Error(t('localPluginsUnavailable'))
    const [plugins, capabilities] = await Promise.all([inspectPlugins(), call('GET local/capabilities')])
    return { plugins: plugins.filter(plugin => plugin.moduleName.startsWith('@missher/')
      && !plugin.moduleName.startsWith('@missher/dsh-superagent') && !plugin.moduleName.startsWith('@missher/sb-')), capabilities }
  }, [call, inspectPlugins], 30000)
  const inspect = useAction(reload)
  return <div className="dt-local-plugins"><div className="dt-plugin-inspect"><p className="dt-hint">{t('localPluginsHint')}</p>
    <Button variant="outline" size="sm" icon={<Icon name="refresh" />} disabled={inspect.busy} onClick={() => { void inspect.run() }}>{t('localPluginsInspect')}</Button></div>
    <LoadState loading={!data && !error} error={error} />
    {data && <><ul className="dt-plugin-list">{data.plugins.map(plugin => {
      const tools = plugin.moduleName === '@missher/dsh-project-ops'
      const session = ['@missher/dsh-context-manager', '@missher/dsh-output-renderer', '@missher/dsh-reasoning-effort',
        '@missher/dsh-session-bridge', '@missher/dsh-focus', '@missher/dsh-memory', '@missher/dsh-mse-learning'].includes(plugin.moduleName)
      const ready = plugin.enabled && plugin.fiberPhase === 'active'
      const count = data.capabilities.tools.filter(tool => tool.registered && tool.worker).length
      return <li key={plugin.entryId} className="dt-plugin-row"><div><strong>{plugin.title?.[t('lang') === 'en' ? 'en' : 'zh'] ?? plugin.moduleName.replace('@missher/', '')}</strong>
        <span>{t(tools ? 'localPluginTools' : session ? 'localPluginSession' : 'localPluginPanel')}</span></div><div className="dt-plugin-state">
        {tools && ready && <span>{t('localPluginToolCount', { count })}</span>}
        <span data-ready={ready || undefined}>{t(!plugin.enabled ? 'localPluginOff' : ready ? 'localPluginLoaded' : 'localPluginLoading')}</span></div></li>
    })}</ul><details className="dt-local-details dt-plugin-tools"><summary>{t('localPluginToolList')}</summary><ul>{data.capabilities.tools.map(tool => <li key={tool.name}>
      <div><strong>{t(`pluginTool.${tool.name}`)}</strong><span>{t(!tool.registered ? 'localPluginMissingTool' : tool.worker ? 'localPluginMemberTool' : 'localPluginRestricted')}</span></div>
      {tool.lastCall && <div className="dt-plugin-call"><span>{t(`workbenchToolState.${tool.lastCall.state}`)}</span><When at={tool.lastCall.at} />
        <SessionButton sessionId={tool.lastCall.sessionId} label={t('localPluginCallSession')} /></div>}
    </li>)}</ul></details></>}
  </div>
}
