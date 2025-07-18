# SzNote - CloudFlare Workers 版本

## 简介

SzNote 是一个简易的在线笔记应用，可以让用户快速记录和分享笔记内容。此版本专为 CloudFlare Workers 平台设计，使其可以在全球范围内快速访问。

## 特性

- 支持 Markdown 语法
- 实时预览
- 密码保护笔记
- 自动保存
- 过期管理
- 全球分布式部署

## 部署步骤

### 前提条件

1. 拥有一个 CloudFlare 账户
2. 安装 Node.js 和 npm
3. 安装 Wrangler CLI（CloudFlare Workers 的命令行工具）

### 安装 Wrangler CLI

```bash
npm install -g wrangler
```

### 登录到 CloudFlare 账户

```bash
wrangler login
```

### 创建 KV 命名空间

在 CloudFlare Dashboard 中创建一个 KV 命名空间，用于存储笔记数据：

1. 登录 CloudFlare Dashboard
2. 进入 Workers & Pages
3. 点击 KV
4. 创建一个新的命名空间，命名为 `SZNOTE_NOTES`
5. 复制生成的命名空间 ID

### 配置 wrangler.toml

编辑 `wrangler.toml` 文件，将你的 KV 命名空间 ID 填入：

```toml
[[kv_namespaces]]
binding = "SZNOTE_NOTES"
id = "你的KV命名空间ID" # 替换为你复制的ID
```

### 安装依赖

```bash
cd workers-site
npm install
```

### 发布到 CloudFlare Workers

```bash
wrangler deploy
```

## 使用说明

部署完成后，你可以通过以下 URL 访问你的应用：

```
https://sznote.你的workers子域名.workers.dev
```

### 基本操作

- 创建笔记：访问应用后自动创建新笔记，或在输入框中输入自定义ID
- 编辑笔记：在左侧编辑区输入内容，右侧实时预览
- 保存笔记：内容会自动保存
- 分享笔记：复制浏览器地址栏中的URL分享给他人

### 安全功能

- 设置密码：点击设置图标，在「安全设置」中设置密码
- 移除密码：在设置中输入当前密码后移除
- 过期时间：可设置笔记在最后访问后的3天、7天、30天或365天后自动删除

## 注意事项

1. CloudFlare Workers 免费计划有一定的请求限制
2. KV 存储有容量限制
3. 密码保护使用 Web Crypto API 实现，安全性高
4. 过期笔记会通过每日定时任务自动清理

## 技术栈

- 前端：HTML, CSS, JavaScript
- 后端：CloudFlare Workers
- 存储：CloudFlare KV
- 加密：Web Crypto API

## 许可证

与原项目相同