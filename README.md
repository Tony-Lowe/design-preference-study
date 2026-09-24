# 设计图像偏好研究

方法名称隐藏的配对盲评，先收集视觉美观判断，再收集指令遵循判断。当前有 37 个 CreatiDesign benchmark 案例：17 个来自用户挑选的 `UNOvsOurs.html`，20 个来自此前筛选的案例。每位参与者抽取 12 组（两个来源池各 6 组），每组完成两项判断，共 24 项。

所有 `img_id`、全局描述、对象框与文字框均已和 Hugging Face 上的 [CreatiDesign benchmark](https://huggingface.co/datasets/HuiZhang0812/CreatiDesign_benchmark) test split 逐项核对。指令评分先显示原始描述和 semantic/pixel 参考图；「叠加布局」和「叠加主体参考」是独立开关，可分别调透明度，并同时作用于两张候选图。布局与主体图层都是透明 PNG，适用于桌面和手机界面。

## 使用

- `/`：参与者入口。开始前确认自愿参与。
- `/?preview=1`：演示会话，明确标记且不计入统计。
- `/admin`：研究管理入口。管理码保存在本地 `.admin-key`，不进入 Git；部署时通过 `STUDY_ADMIN_KEY` secret 配置。
- 题目与答案先保存在浏览器本机，进入问卷无需等待 API；恢复连通后，离线会话和答案会自动补传。同一评分重试不会重复记票。完成后若仍无法连接，可一键复制答卷文本或下载 JSON，发送给研究者；管理页支持粘贴或上传文件，按 6 项分批导入并去重。首次成功同步时读取 Cloudflare 提供的 `CF-Connecting-IP` 并写入 `study_sessions.ip_address`，不接受浏览器提交的 IP。手工导入与未同步会话没有参与者 IP。管理页和导出可查看已记录的 IP；撤回已同步会话时对应 IP 与评分一并删除。
- GitHub Pages 发布前端与图片，独立评分 API 保存记录；参与者无需 GitHub 登录。前端可独立运行，自动收集结果仍需 API 可达。手工交卷是网络不可达时的备用路径，不会静默地把答案写入 GitHub。参与页面可切换中文和英文。

`STUDY_PROTOCOL.md` 记录样本来源、随机化、统计口径及正式收集要求。`data/unovsours-import-report.json` 记录 HTML 导入来源；`data/benchmark-selected-metadata.json` 保存与官方 test split 匹配的轻量标注快照。

## 本地开发

使用现有锁文件：`npm run install:ci`。构建：`npm run build`。`.env` 与线上 secret 使用相同键名；不要提交真实管理码。

`scripts/import_unovsours.py` 会导入用户从 `UNOvsOurs.html` 选出的样例，并保留之前的 20 个案例。导入后运行 `python3 scripts/attach_benchmark_annotations.py`，以官方 benchmark 标注覆盖 prompt 和布局元数据、生成全部透明布局图；再运行 `python3 scripts/build_subject_reference_overlays.py`，用官方 subject segmentation 从 pixel layer 中提取对齐主体参考并生成透明叠加图。两步都会更新 study version。重跑基础导入脚本后也必须重跑这两步。

## 数据与投票

`data/cases.json` 顶层包含 `version`、`mode`、`sampling`、`pools` 与 `cases`。每个 case 包含唯一 `id`、来源池（`user_selected` / `prior_reviewed`）、官方 benchmark prompt、五张图像资源、透明 layout/subject overlays 与来源记录。每组始终包含 All-in-Image，另一张图随机为 CreatiDesign 或 UNO。每个来源池内各有三组对比每个 baseline；位置平衡后，12 组随机排序。

浏览器本地生成匿名的 12 组图像与条件，但界面在参与者作出美观判断前不显示区域、文字或主体参考。每项判断先写入浏览器本地存储并立即进入下一步，后台按组批量上传；只有云端确认全部 24 项后才显示已同步。上传失败时本机记录保留，可自动或手动重试，并可下载答卷。两类判断分别统计，美观为主要结果，指令遵循为辅助结果。

管理结果只显示当前数据版本。演示数据不会进入管理统计或导出。暂无真人数据时显示零和空统计，不填充虚构票数；跳过票不进入胜率分母，平局保留并单独显示。

## 可选：手工替换布局叠加图

如需替换官方渲染版本，可导出 `<case_id>.png` RGBA 图片，保持候选图宽高比和透明背景，再运行 `python3 scripts/import_layout_overlays.py /absolute/directory`。导入器检查透明度及三个输出的宽高比，并更新研究版本。

## GitHub Pages build

参与者网址为 https://tony-lowe.github.io/design-preference-study/ ，评分 API 为 https://canvas-preference-study.tonylowe001031.chatgpt.site 。构建命令：`VITE_STUDY_API=https://canvas-preference-study.tonylowe001031.chatgpt.site npx vite build --config vite.static.config.mts`。只发布 `web-dist`，不要发布 backend source 或管理码。本地随机分组所需的案例清单随前端发布，方法名称仍不在正常参与界面展示。
