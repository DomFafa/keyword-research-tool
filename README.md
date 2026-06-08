# Keyword Research Tool

这个仓库用于搭建关键词调研工具。当前先完成第一步基础设施：不接 Google Sheets API，直接复用本机 Chrome 的 Google 登录态读取输入表。

## 当前能力

- 读取默认 Google Sheet：`keyword工具`
- 读取 `工具账号密码` 子表里的 `运行浏览器账号`
- 在本机 Chrome profiles 中匹配该账号；如果对应 profile 没有打开，会打开对应 profile
- 用匹配到的 profile 读取 `词根拓展` 子表
- 执行 Semrush 第一步词根拓展流程：
  - 识别当前页面是在 3ue 登录页、3ue 首页、Semrush 首页、关键词概览页，还是关键词魔法工具页
  - 通过 Semrush 前端内部 RPC 查询 `词根拓展` 的 `词根`、`匹配类型`、`搜索量范围`、`KD范围`
  - 采集 Keyword Magic RPC 返回的 `关键词`、`搜索量`、`KD`
  - 关键词模式通过 Keyword Overview RPC 返回本地/全球搜索量和 KD
  - 输出本地 CSV/JSON，并写入 `关键词总表` 的 A-D 列
- 输出结构化 JSON：`output/google-sheet-input.json`
- 不需要 Google API key 或 OAuth 应用
- Semrush 流程默认按邮箱 `vc.ddom@gmail.com` 匹配系统 Chrome profile，并通过 Chrome DevTools WebSocket 复用该 profile 的登录态

## Semrush 调用方式

- Keyword Magic：`POST /kmtgw/v2/webapi`
  - `ideas.GetKeywordsSummary` 获取筛选后的总关键词数
  - `ideas.GetKeywords` 分页获取关键词列表
- Keyword Overview：`POST /kwogw/v2/webapi`
  - `keywords.GetInfo` 获取搜索量和 KD

脚本仍然需要先通过 Chrome 登录态进入 `sem.3ue.com`，RPC 请求在页面上下文内发出，以复用当前 3ue/Semrush 会话。

## 环境要求

- Node.js 22+
- Chrome 已登录能访问目标 Google Sheet 的账号
- 本机已安装 Google Chrome

Semrush 默认按 Chrome profile 邮箱 `vc.ddom@gmail.com` 匹配当前机器上的实际 profile 目录，再启动调试模式 Chrome：

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=0 \
  --user-data-dir="$HOME/Library/Application Support/Google/Chrome" \
  --profile-directory="<匹配到的 Profile 目录>"
```

直接使用系统 Chrome profile 时，不复制 profile。运行前请关闭正在使用系统 Chrome profile 的普通 Chrome 窗口，否则 Chrome 可能复用现有进程并忽略 remote debugging 参数。

以后日常先用这个入口启动 Chrome：

```bash
npm run chrome:semrush
```

可用环境变量覆盖：

- `CHROME_PATH`
- `CHROME_REMOTE_DEBUGGING_PORT`
- `CHROME_USER_DATA_DIR`
- `CHROME_PROFILE` 或 `CHROME_PROFILE_MATCH`：可填 profile 目录名、profile 名或邮箱

## 使用

```bash
npm run read:sheet
```

默认读取：

- 账号配置子表：`工具账号密码`
- 关键词输入子表：`词根拓展`

换表格、gid 或子表名：

```bash
npm run read:sheet -- --sheet="https://docs.google.com/spreadsheets/d/.../edit?gid=0#gid=0" --gid=0 --account-sheet="工具账号密码" --keyword-sheet="词根拓展"
```

换输出文件：

```bash
npm run read:sheet -- --out=output/my-sheet.json
```

执行 Semrush 第一步：

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

## 输出结构

```json
{
  "source": {
    "sheetUrl": "...",
    "gid": "0",
    "accountSheetName": "工具账号密码",
    "keywordSheetName": "词根拓展",
    "readAt": "..."
  },
  "toolAccount": {
    "semrush账号": "imomo",
    "运行浏览器账号": "vc.ddom@gmail.com"
  },
  "chromeProfile": {
    "directory": "Default",
    "email": "vc.ddom@gmail.com"
  },
  "sheets": {
    "词根拓展": {
      "rows": [
        {
          "词根": "generator",
          "关键词": "",
          "匹配类型": "完全匹配"
        }
      ]
    }
  }
}
```

Semrush 第一步会输出候选关键词，本地文件可直接用于后续筛选和写表。
