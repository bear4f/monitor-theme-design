# monitor-theme-design

[monitor](https://github.com/monitor-probe/monitor) 的公开页主题。

Fork 自 [tom2almighty/monitor-theme-design](https://github.com/tom2almighty/monitor-theme-design)，在原主题上增加**访客权限**，其余界面保持不变。原主题 Fork 自 [stqfdyr/monitor-theme-serverstatus](https://github.com/monitor-probe/monitor-theme-serverstatus)，结合 tweakcn(ShadcnUI) Tokens 与 Zen Browser 风格的噪点磨砂效果。

![预览](preview.png)

## 特性

- **访客权限**：未登录的访客默认只能看网络延迟；系统概览、资源历史图表和到期时间登录后台后才显示。见下文[访客权限](#访客权限)。
- **配色切换**：均含亮色/暗色模式。
- **噪点与磨砂效果**：两个参数各支持 0%~100% 无级调节。

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