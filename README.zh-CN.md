# GitHub Control Center

[![Visual Studio Marketplace 版本](https://vsmarketplacebadges.dev/version-short/mts88.github-control-center.svg)](https://marketplace.visualstudio.com/items?itemName=mts88.github-control-center)
[![Visual Studio Marketplace 安装量](https://vsmarketplacebadges.dev/installs-short/mts88.github-control-center.svg)](https://marketplace.visualstudio.com/items?itemName=mts88.github-control-center)
[![Visual Studio Marketplace 评分](https://vsmarketplacebadges.dev/rating-short/mts88.github-control-center.svg)](https://marketplace.visualstudio.com/items?itemName=mts88.github-control-center&ssr=false#review-details)
[![Open VSX 版本](https://img.shields.io/open-vsx/v/mts88/github-control-center?label=Open%20VSX&logo=vscodium)](https://open-vsx.org/extension/mts88/github-control-center)

[English](./README.md) | **简体中文**

这款 VS Code 扩展由开发者打造，面向日常使用 GitHub 的开发者。你可以在编辑器里集中管理等你审查的 PR 和自己尚未关闭的 PR。活动栏徽标显示数量，弹出通知提醒你跟进，PR 详情页的布局类似 GitHub。无需检出分支，就能在编辑器内查看差异、添加行内评论和提交审查，还能一键执行审查、合并和检出操作。

## 目录

- [功能](#功能)
  - [审查状态图标](#审查状态图标)
- [身份验证](#身份验证)
- [设置](#设置)
- [AI 功能](#ai-功能)
- [审查 PR](#审查-pr)
  - [变更文件](#变更文件)
  - [查看差异](#查看差异)
  - [添加评论](#添加评论)
  - [待提交的审查](#待提交的审查)
  - [已有的审查讨论](#已有的审查讨论)
- [静音仓库和组织](#静音仓库和组织)
- [安装](#安装)

## 功能

- **三个视图**集中在活动栏中，均按仓库分组。**To Review**（待审查）显示向你发出审查请求的 PR，包括发给你所在团队的请求。**Reviewed**（已审查）显示你已批准且批准仍有效的 PR。**My PRs**（我的 PR）显示你尚未关闭的 PR。你已评论、已请求修改，或因新提交而使批准失效的 PR 仍需跟进，会在 To Review 中排在待处理的审查请求之后，并标明你的审查状态，直到 PR 关闭或再次向你发出审查请求。批准 PR 后，它会立即移到 Reviewed。
- **活动栏徽标**显示 PR 数量，可以分别设置各个列表是否计入。
- **弹出通知**会在有新的 PR 请求你审查，或你自己的 PR 获得批准或收到修改请求时出现。通知提供快捷操作（Open、Settings）。重新加载后的首次拉取不会集中弹出大量通知。
- **PR 详情面板**。点击 PR 即可在 VS Code 中打开类似 GitHub 的页面。讨论时间线会将提交紧凑地分组，并渲染 Mermaid 图表。页面还显示合并面板（审查结论、检查结果、冲突、分支是否落后）、审查者列表（标记已失效的批准）、标签和整体变更统计。
- **PR 操作**。你可以发表评论、批准、请求修改、按仓库允许的方式合并，将自己的草稿 PR 标记为可供审查，或更新落后的分支（通过类似 GitHub 的选择界面，选择变基或创建合并提交）。如果工作区已打开该仓库，还可以检出 PR 分支。点击 CI 检查名称可直接打开对应的运行记录。
- **在编辑器内审查代码**。展开 PR 条目，就能按目录树或平铺列表浏览变更文件，并打开基于 PR 提交的实际差异。无需检出分支，也支持来自 fork 的 PR。和在 GitHub 上一样，你可以针对单行、选中的多行或整个文件发表评论，先存入待提交的审查，再以 Comment、Approve 或 Request changes 提交。已有的审查讨论会显示在对应代码行旁，支持回复和标记为已解决。每个文件的已查看状态会与 GitHub 同步。
- **列表快捷操作**。使用条目上的图标，可以检出 PR 分支或在浏览器中打开 PR。右键可以复制 PR URL 或分支名，也可以静音该仓库或其所属组织。
- **搜索并静音**。运行 “Manage Muted Repositories” 命令打开选择列表，输入时会实时搜索 GitHub。点击即可静音或取消静音单个仓库或整个组织。
- **AI 审查摘要**（可选，需要 [Claude Code](https://claude.com/product/claude-code) CLI）。点击 PR 详情面板中的 **✨ Brief me**，即可根据实际代码差异生成面向审查者的摘要，包括改了什么、有哪些风险点，以及建议的阅读顺序。参见 [AI 功能](#ai-功能)。
- **零运行时依赖**。使用原生 `fetch`、VS Code 内置的 GitHub 身份验证，以及 GitHub 渲染好的 Markdown（`bodyHTML`）。Mermaid 图表由扩展内置的 Mermaid 在本地渲染，无需 CDN，渲染过程不会向外发送数据。

### 审查状态图标

PR 出现的地方都会用小图标表示审查状态。

| 图标 | 含义 |
| ---- | ------- |
| ✓ | 已批准。在树形列表的条目标题中，表示**由你**批准 |
| ☑ | 由其他人批准（仅用于树形列表） |
| ↻ | 已请求修改 |
| 💬 | 已评论 |
| ● | 需要审查 / 等待审查 / 审查结论已撤销 |

详情面板中的图标以绿色、红色和黄色区分。若批准早于最新一次提交（包括强制推送的情况），审查者侧栏会用黄色的 `✓ approved · stale` 标记这次**已失效的批准**。树形列表每行开头的图标显示 CI 状态（通过、失败，运行中则显示旋转图标，草稿 PR 显示草稿图标），与标题中的审查状态图标相互独立。

## 身份验证

扩展使用 VS Code 内置的 GitHub 身份验证提供程序，需要 `repo` 和 `read:org` 两个权限范围。`repo` 用于查看私有仓库中的 PR，`read:org` 用于显示发给团队的审查请求。首次使用时会提示你登录。

## 设置

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| `githubControlCenter.badge.countToReview` | `true` | 将 To Review 视图中的 PR 计入徽标数量，包括收到审查请求的 PR 和仍需跟进的 PR。 |
| `githubControlCenter.badge.countMine` | `false` | 将你自己的未关闭 PR 计入徽标数量。 |
| `githubControlCenter.badge.countReviewed` | `false` | 将 Reviewed 视图中的 PR（你已批准且批准仍有效的 PR）计入徽标数量。开启 `toReview.hideReviewed` 时，此设置不生效。 |
| `githubControlCenter.notifications.enabled` | `true` | 收到新的审查请求，或你自己的 PR 有了审查结论时，显示通知。 |
| `githubControlCenter.mutedRepos` | `[]` | 将指定条目从列表、徽标计数和通知中隐藏。`owner/repo` 表示单个仓库，`owner`（或 `owner/*`）表示整个组织。建议用 **Manage Muted Repositories** 命令在可搜索的列表中编辑。 |
| `githubControlCenter.toReview.hideDrafts` | `false` | 在 To Review 列表、徽标计数和通知中隐藏草稿 PR。 |
| `githubControlCenter.toReview.hideReviewed` | `false` | 隐藏所有你已审查且尚未再次收到审查请求的 PR。开启后，Reviewed 视图会隐藏，To Review 也不会显示已审查的条目。 |
| `githubControlCenter.updateBranch.defaultMethod` | `REBASE` | 执行 Update branch 时预选的更新方式（`REBASE` 或 `MERGE`）。 |
| `githubControlCenter.files.layout` | `tree` | PR 条目下的变更文件布局。`tree` 按目录层级显示，并折叠只有一个子项的文件夹。`flat` 为平铺列表。也可从任一视图的 `…` 菜单切换。 |
| `githubControlCenter.ai.backend` | `claude-code` | AI 功能使用的本地后端。目前仅支持 Claude Code。 |
| `githubControlCenter.ai.language` | `English` | AI 生成内容所用的语言，适用于所有 AI 后端。 |
| `githubControlCenter.ai.claude.command` | `claude` | Claude Code CLI 的路径。这是计算机级设置，工作区无法覆盖，仅适用于 Claude Code 后端。 |
| `githubControlCenter.ai.claude.model` | `sonnet` | 传给 `claude --model` 的模型，可选 Sonnet、Haiku、Opus 或 CLI 中配置的默认模型。仅适用于 Claude Code 后端。 |

## AI 功能

PR 详情面板中的 **✨ Brief me** 按钮会生成一份面向审查者的摘要，说明 PR 实际改了什么、风险在哪里、建议按什么顺序阅读文件。摘要以代码差异为依据，因为 PR 的标题和描述可能没有及时更新。

- **需要在本机安装 [Claude Code](https://claude.com/product/claude-code) CLI**。确保 PATH 中能找到 `claude`，或设置 `githubControlCenter.ai.claude.command`。扩展以非交互模式运行 CLI，使用你已有的 Claude 订阅，无需 API 密钥。找不到 CLI 时，界面不会显示 AI 功能。
- **隐私**。点击按钮后，PR 标题、描述、文件列表和补丁会通过你自己的 Claude CLI 发送给 Anthropic，走的是你平时使用 Claude Code 的同一渠道。
- **安全**。CLI 在隔离配置下运行，所有工具均已禁用，因此 PR 内容无法触发任何操作或读取你的 Claude 配置。摘要基于不受信任的 PR 内容，请将其作为审查参考，审查结论仍需自行判断。
- 摘要按 PR 的最新提交缓存，只存储在本地，重启 VS Code 后仍可保留，且不会同步。生成摘要后，按钮会保持禁用，直到作者推送新提交，届时按钮重新启用，可以生成新的摘要。若要强制重新生成（例如修改语言设置后），请在命令面板中运行 **GitHub Control Center: Clear AI Brief Cache**。

## 审查 PR

无需离开编辑器或检出分支，就能完成整套代码审查流程。

### 变更文件

在任一视图中展开 PR 条目即可加载变更文件。文件可以按**目录树**显示（和资源管理器一样折叠只有一个子项的文件夹），也可以按**平铺列表**显示。可通过视图 `…` 菜单中的 *View Files as List / Tree* 切换，也可修改 `githubControlCenter.files.layout`。每个文件都标明变更类型（新增、修改、删除或重命名），悬停可查看变更统计。勾选复选框会在 GitHub 上将该文件标记为**已查看**，与网页端的操作一致。

### 查看差异

点击文件，VS Code 会在原生差异编辑器中比较 PR 的基准提交和最新提交。扩展按 PR 的提交 SHA 从 GitHub API 获取文件内容。

- 无需在本地检出分支，工作树也不会被改动。
- 来自 fork 的 PR 开箱即用。
- 无论本地处于什么状态，看到的都是该 PR 的实际差异。

### 添加评论

和 GitHub 一样，只有差异中显示的行才能添加行内评论。

- **单行**。点击变更行或上下文行旁的 `+`。
- **多行**。选中要评论的行，再点击选区旁的 `+`。选中的行必须在同一个差异块内。
- **整个文件**。点击差异编辑器标题栏上的评论图标，也可在命令面板中运行 *GitHub Control Center: Comment on File*。二进制文件和因过大而无法显示文本差异的文件也可以用这种方式评论。

每个评论框都有两个操作。**Add Review Comment** 将评论加入待提交的审查，**Add Single Comment** 则立即发布评论。如果已有待提交的审查，须先提交或丢弃它，才能单独发布评论。

### 待提交的审查

添加第一条审查评论时，GitHub 会创建一份**待提交的审查**。提交前，草稿评论仅自己可见，状态栏会显示 `PR #N: k pending`。审查完成后，可以选择提交或丢弃。

- **Submit Review…**。点击状态栏或在命令面板中运行此命令，可选择 Comment、Approve 或 Request changes。请求修改时必须填写审查摘要。
- **Discard Pending Review**。确认后会删除这份审查草稿及其中的所有评论。

### 已有的审查讨论

PR 中已有的审查讨论会在差异两侧各自对应的代码行旁显示，包含完整对话。你可以直接在讨论中回复，也可以在讨论标题处标记为已解决或重新打开。待提交的评论会有标记，已解决的讨论默认折叠。如果讨论所对应的代码行已从差异中消失，该讨论会被跳过，可前往 GitHub 查看。

## 静音仓库和组织

静音后，相应条目会同时从两个列表、徽标计数和通知中消失。

可以通过以下三种方式静音。

- **使用可搜索的选择列表**。在命令面板中运行 **GitHub Control Center: Manage Muted Repositories**，或从任一视图的 `…` 菜单打开。列表会显示已静音的条目（选中即可取消静音）以及当前你关注的仓库（选中即可静音）。输入时会实时搜索 GitHub。如果输入的内容不含斜杠，列表会提供 *“Mute everything from …”* 选项，用于静音整个组织。
- **右键点击 PR 条目**。选择 *Mute Repository* 或 *Mute Organization*。
- **在设置中编辑**。手动修改 `githubControlCenter.mutedRepos`。

条目格式如下，大小写均可。

```jsonc
"githubControlCenter.mutedRepos": [
  "acme/noisy-repo",   // mutes one repository
  "some-org",          // mutes the whole organization
  "other-org/*"        // same, alternative spelling
]
```

要取消静音，可以在选择列表中选中相应条目（已静音的条目会排在最前面并带有标记），也可以在设置中删除该条目。

## 安装

从 [GitHub Releases 的最新版本](https://github.com/mts88/github-control-center/releases/latest)下载 `.vsix`，然后运行下面的命令。

```bash
code --install-extension github-control-center-<version>.vsix
```

也可以用下面的命令自行构建并安装。

```bash
yarn install
yarn dlx @vscode/vsce package --no-dependencies
code --install-extension github-control-center-<version>.vsix
```

开发环境的配置方式见 `CONTRIBUTING.md`。
