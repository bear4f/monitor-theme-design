# monitor-theme-design

[monitor](https://github.com/monitor-probe/monitor) 的公开页主题。

Fork 自 [tom2almighty/monitor-theme-design](https://github.com/tom2almighty/monitor-theme-design)，在原主题上增加**访客权限**，其余界面保持不变。原主题 Fork 自 [stqfdyr/monitor-theme-serverstatus](https://github.com/monitor-probe/monitor-theme-serverstatus)，结合 tweakcn(ShadcnUI) Tokens 与 Zen Browser 风格的噪点磨砂效果。

![预览](preview.png)

## 特性

- **延迟摘要**：首页每个节点下方直接显示最多三条线路的最新延迟、最近一小时走势与丢包率，不用展开。见下文[延迟摘要](#延迟摘要)。
- **访客权限**：未登录的访客默认只能看网络延迟；系统概览、资源历史图表和到期时间登录后台后才显示。见下文[访客权限](#访客权限)。
- **配色切换**：均含亮色/暗色模式。
- **噪点与磨砂效果**：两个参数各支持 0%~100% 无级调节。

## 延迟摘要

首页列表里每个节点下方有一条摘要：最多三条线路并排，每条是线路名、最新一次延迟、最近一小时的走势线和丢包率。丢包达到 1% 标为琥珀色，达到 5% 标为红色。展开节点时摘要收起，由完整的延迟图代替；窄屏上只留线路名和延迟数值。

后台「主题」页本主题的设置里，「首页列表」一组有两项：

| 设置 | 默认 | 说明 |
|---|---|---|
| 节点下方显示延迟摘要 | 开 | 关闭后列表和原来一样，也不再发下面说的查询 |
| 摘要显示的延迟线路 | 空 | 每行一个延迟监控的名称，按填写顺序优先，每个节点显示它有的前三条；留空自动取前三条 |

线路可以多填：比如依次填三条国内线路和三条海外线路，有国内监控的节点显示国内三条，没有的自动显示后面的。

开启后每个节点每分钟多一次延迟查询（最近一小时、60 个点），同时最多十个，页面在后台时不查。

摘要是整批一起显示的，不会一行一行冒出来：

- 再次访问时，上次的摘要存在浏览器本地（24 小时内有效），和列表在同一帧画出来，新数据到了再整批替换；查询在节点列表返回之前就已经发出。
- 第一次访问没有本地数据：页面一打开、主脚本还在下载时，`index.html` 里的一小段脚本就先去取站点信息、节点列表、主题设置和前 24 个节点的延迟，脚本下载完时这些大多已经到了，摘要基本随列表一起出现。没赶上的先显示占位条，全部查完（或 2.5 秒到点）后一次显示。
- 每分钟的刷新同样整批替换。延迟对访客本来就可见，所以这一条不受访客权限影响。

## 访客权限

在后台「主题」页点本主题卡片上的设置按钮，「访客权限」一组有四项开关，只对未登录的访客生效，管理员登录后始终能看到全部内容：

| 设置 | 默认 | 关闭后访客看不到 |
|---|---|---|
| 访客可查看「系统概览」 | 关 | 展开节点后的「系统概览」标签（系统信息、资源监控、流量统计、账期信息），以及监控页标题里的在线时长和 agent 版本 |
| 访客可查看资源历史图表 | 关 | 监控页的 CPU / 内存 / 网络 / 硬盘图表，只留延迟图 |
| 访客可查看列表实时指标 | 开 | 首页列表的系统、在线、到期、负载、网速、CPU、内存、硬盘、流量各列和顶部的网速、流量汇总，只留状态、名称、位置 |
| 访客可查看到期时间 | 关 | 首页列表的「到期」列，以及系统概览「账期信息」里的到期日与剩余天数 |

设置还没读到时（包括 hub 1.2.0 及更早没有主题设置接口的情况）按默认值处理，不会先把内容画出来再收回。

> [!WARNING]
> 这是**显示层**的限制，不是接口层的权限。主题只是不画这些内容，hub 的 `/api/nodes` 和 `/api/ws` 对匿名请求照样返回 CPU、内存、流量、价格、到期日等字段，懂技术的访客打开浏览器开发者工具就能看到。要让数据真正不出站，只能由 hub 不输出：把节点设为不公开，或关闭「开放公开状态页」。

## 安装

### 方法一：后台上传压缩包

1. 在 [Releases](https://github.com/bear4f/monitor-theme-design/releases) 页面下载最新的 `theme.tar.gz`。
2. 登录 monitor hub 后台，进入「主题」管理页面。
3. 上传 `theme.tar.gz` 完成安装。卡片上的 ⟳ 按钮可检查本仓库是否有新版本。

### 方法二：解压至目录

将 release 产物解压到 hub 所在主机 `--themes` 目录下的 `monitor-theme-design/` 文件夹：

```bash
mkdir -p /path/to/monitor/themes/monitor-theme-design
tar -xzf theme.tar.gz -C /path/to/monitor/themes/monitor-theme-design
```

然后在后台「主题」页刷新并选中切换。

## 协议与致谢

- 本项目基于 [MIT License](LICENSE) 开源。
- 感谢 [monitor-probe/monitor](https://github.com/monitor-probe/monitor)。
- 感谢 [tom2almighty](https://github.com/tom2almighty) 的 [monitor-theme-design](https://github.com/tom2almighty/monitor-theme-design) 主题。
- 感谢 [stqfdyr](https://github.com/stqfdyr) 的原版 [monitor-theme-serverstatus](https://github.com/monitor-probe/monitor-theme-serverstatus) 主题。
- 国旗图标来自 [flag-icons](https://github.com/lipis/flag-icons)，MIT 协议。