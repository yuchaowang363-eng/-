/*  小月亮 · Service Worker
 *  只负责一件事：把界面文件缓存下来，让它在没网的时候也能打开。
 *  数据本身不在缓存里，在页面的 localStorage 里。
 *
 *  策略是「网络优先、离线回退」，不是「缓存优先」：
 *  这个项目还在改，缓存优先会让改完的样式和脚本迟迟不生效，得不偿失。
 *  离线回退已经足够保证没网时照样能打开——没网时浏览器会立刻报错，
 *  不会真的干等到超时。
 */
const VERSION = "v3";
const CACHE = "xiaoyueliang-" + VERSION;

const BASE = new URL("./", self.location).href;
const SHELL = [
  "",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png"
].map((p) => BASE + p);

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function put(req, res) {
  if (res && res.ok && res.type === "basic") {
    caches.open(CACHE).then((c) => c.put(req, res)).catch(() => {});
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  /* 打开页面，以及样式、脚本：联网时永远拿最新的，没网才用缓存。*/
  const fresh = req.mode === "navigate" ||
                req.destination === "document" ||
                req.destination === "style" ||
                req.destination === "script";

  if (fresh) {
    e.respondWith(
      fetch(req)
        .then((res) => { put(req, res.clone()); return res; })
        .catch(() => caches.match(req).then((hit) =>
          hit || caches.match(BASE + "index.html").then((r) => r || caches.match(BASE))))
    );
    return;
  }

  /* 图标之类很少变的东西：先用缓存，同时在背后悄悄更新。*/
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => { put(req, res.clone()); return res; });
      return hit || net.catch(() => hit);
    })
  );
});
