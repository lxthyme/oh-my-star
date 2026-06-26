export async function register() {
  // Node.js undici (built-in fetch) 不自动读取系统代理；
  // HTTPS_PROXY 有值时注入 ProxyAgent，使服务端所有 fetch（含 Auth.js OAuth token 交换）走代理。
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy
  if (proxy) {
    const { ProxyAgent, setGlobalDispatcher } = await import("undici")
    setGlobalDispatcher(new ProxyAgent(proxy))
  }
}
