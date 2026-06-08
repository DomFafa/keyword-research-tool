# Keyword Research Tool

这个仓库用于搭建关键词调研工具。Semrush 流程现在使用一个专用 Chrome profile 保存 3ue/Semrush 登录态，Google Sheet 读写直接走 Google Sheets API。

## 当前能力

- 读取默认 Google Sheet：`keyword工具`
- 读取 `工具账号密码` 子表里的 `semrush账号`、`semrush密码`
- 读取 `词根拓展` 子表里的关键词任务
- 执行 Semrush 第一步词根拓展流程：
  - 自动登录 3ue
  - 打开 Semrush
  - 通过 Semrush 前端内部 RPC 查询 `词根`、`匹配类型`、`搜索量范围`、`KD范围`
  - 采集 Keyword Magic RPC 返回的 `关键词`、`搜索量`、`KD`
  - 关键词模式通过 Keyword Overview RPC 返回本地/全球搜索量和 KD
  - 输出本地 CSV/JSON，并写入 `关键词总表`

## Semrush 调用方式

- Keyword Magic：`POST /kmtgw/v2/webapi`
  - `ideas.GetKeywordsSummary` 获取筛选后的总关键词数
  - `ideas.GetKeywords` 分页获取关键词列表
- Keyword Overview：`POST /kwogw/v2/webapi`
  - `keywords.GetInfo` 获取搜索量和 KD

RPC 请求在 `sem.3ue.com` 页面上下文内发出，以复用专用 Chrome profile 里的 3ue/Semrush 会话。

## 环境要求

- Node.js 22+
- 本机已安装 Google Chrome
- Google Sheet 已授权给 `GOOGLE_SERVICE_ACCOUNT_JSON` 对应的 service account
- 先用专用 profile 登录一次 3ue/Semrush

默认专用 profile：

```text
~/Library/Application Support/keyword-research-tool/semrush-chrome
```

这个 profile 不复制、不复用日常 Chrome profile，也不需要 DevTools 端口。

可用环境变量：

- `GOOGLE_SERVICE_ACCOUNT_JSON`：service account JSON 路径
- `SEMRUSH_CHROME_PATH`：Chrome 可执行文件路径，默认 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- `SEMRUSH_CHROME_USER_DATA_DIR`：Semrush 专用 Chrome profile 路径
- `GOOGLE_SHEET_URL`：默认任务表 URL

## 初始化登录

```bash
npm install
npm run semrush:login
```

打开 Chrome 后，手动登录 3ue/Semrush。登录完成后关闭窗口或按 `Ctrl-C`。

## 执行 Semrush 第一步

```bash
npm run semrush:step1 -- --reset --max-pages=all
```

常用参数：

```bash
npm run semrush:step1 -- --row=2 --max-pages=all
npm run semrush:step1 -- --row=2 --max-pages=1 --skip-sheet-write
npm run semrush:step1 -- --keyword-total-gid=999267438
```

输出文件：

```text
output/semrush-step1/root-generator.keywords.json
output/semrush-step1/root-generator.keywords.csv
output/semrush-step1/root-generator.state.json
```

## Google Sheet

默认读取：

- 账号配置子表：`工具账号密码`
- 关键词输入子表：`词根拓展`
- 输出子表：`关键词总表`

换表格：

```bash
npm run semrush:step1 -- --sheet="https://docs.google.com/spreadsheets/d/.../edit?gid=0#gid=0"
```

检查表格读取：

```bash
npm run read:sheet
```
