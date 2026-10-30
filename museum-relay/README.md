# 博物馆连接服务

该服务只转发本项目的博物馆接口与经过签名授权的照片请求，用于手机无法直接连接原云端域名的情况。照片和记录继续存储在原来的 Supabase 项目中。

无需后台管理密钥，也不在服务器中保存邀请钥匙。接口请求仍由原服务校验博物馆和邀请凭证；照片请求仍由原存储服务校验签名及有效期。不能指定任意上游地址。

Node.js 22+，运行 `npm start`，端口由 `PORT` 指定。Render 自动提供 `RENDER_EXTERNAL_URL`，用于生成正确的照片访问地址。选用 Free Web Service 时，空闲休眠后首次连接可能需要约一分钟唤醒。此服务不使用本地磁盘存储照片或数据库。

`npm test` 验证邀请凭证转发、拒绝无权限请求、私有照片签名验证、跨域响应及任意代理请求拒绝。测试使用本地模拟云端，不接触真实记录。

## Netlify 免费部署

Netlify 项目的 Base directory 设为 `museum-relay`，使用本目录的 `netlify.toml`。无需构建命令；发布目录为 `public`，Edge Functions 从 `netlify/edge-functions` 自动打包。不要将原仓库根目录发布为本服务。

此入口不使用 Render，也不需要环境变量或任何后台管理密钥。通过标准 Request/Response API 转发文字和照片，保留原有的 5 MB 照片上限；前端仍需在服务部署并确认手机可访问后，才把 `config.js` 的 `apiUrl` 切换为新地址的 `/api`。

Netlify 项目：`yuchao-ruyi-museum-api`（ID `659e776f-bbc8-4823-9cb9-6e52a2185ef6`），连接检测地址为 `https://yuchao-ruyi-museum-api.netlify.app/health`。本目录使用 CLI 发布：`netlify deploy --prod --site 659e776f-bbc8-4823-9cb9-6e52a2185ef6`。新项目需要在 Netlify 设置中公开生产入口，接口自身仍强制校验原有邀请凭证。
