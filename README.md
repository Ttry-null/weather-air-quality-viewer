# 晴雨录 · 天气与空气质量查询(纯静态网页)

任意城市、任意时间段的天气温度变化曲线与空气质量(AQI、PM2.5、PM10 等)变化曲线,城市详情与多城市对比分开显示,可下载 **JSON / CSV / SVG**,并带网页图标(favicon)。

> **无后端**:整个网站就是几个静态文件,数据由浏览器直接请求 [Open-Meteo](https://open-meteo.com/) 公开 API(全部接口开放 CORS、无需 API Key)。

## 功能

- 🔍 任意城市检索:中文 / 拼音 / 英文均可,如 `北京`、`Shanghai`、`東京`;输入时实时联想
- 📑 **城市详情 / 城市对比 两个独立视图**(顶部标签切换),单城市详情页内还有**粘性城市索引**:点击跳转、滚动自动高亮,索引中每个城市带 ✕ 可快速移除
- 🎨 **每个城市使用不同颜色**(自动从调色板分配未占用的颜色,删除后重新添加也不会撞色)
- 🔄 **添加 / 删除城市后自动刷新全部城市**的数据,保证所有城市图表时间范围一致
- 🌓 **深色 / 浅色主题切换**(左下角按钮,默认浅色,记忆选择;图表配色随主题切换,导出 SVG 自动转白底)
- ⬆ **回到顶部按钮**:页面下滑后出现在右侧下三分之一处,一键回到顶部
- 🔤 字体:**Inter**(本地打包,观感接近苹果 SF Pro)+ 系统中文/回退字体
- 📅 任意时间段:
  - 天气历史(再分析 ERA5)自 **1940-01-01** 起,预报 **16 天**
  - 空气质量(CAMS)历史自 **2021-09-27** 起(各地点实际起点不同,页面自动提示),预报约 **5 天**
- 🌡 温度变化曲线:≤10 天显示每小时气温曲线 + 每日最低/最高色带;更长跨度按日展示
- 🌫 空气质量曲线:中国 AQI(按 HJ 633-2012 由污染物浓度估算)+ 美国 AQI,以及 PM2.5 / PM10 / NO₂ / SO₂ / O₃ / CO 可开关曲线,带 AQI 等级色带
- 📊 多城市对比(最多 8 城):平均气温 / 中国 AQI / PM2.5 叠加曲线 + 汇总统计表
- ⬇ 数据下载:每个城市可下载 **JSON**(含原始 API 响应)、**CSV**(日均值,带 BOM,Excel 直接打开)、**SVG**(弹窗选择下载单个图表或全部图表合并);对比视图另有对比 CSV / SVG
- 📌 网页图标:SVG favicon + PNG + apple-touch-icon
- 💾 自动记忆上次选择的城市、日期与视图(浏览器 localStorage)

## 本地打开 / 使用

**方式一(推荐日常用):目录整体使用**
双击 `index.html`,或在目录下运行:

```bash
python -m http.server 8000
# 打开 http://localhost:8000
```

**方式二(单文件版,便携)**
`index.single.html` 是把页面所有样式、脚本、字体、图标**全部内联**后的单个文件(约 216 KB)。把它单独拷到任何地方,双击即可打开,不依赖其他文件。修改源码后可重新生成:

```bash
python build_single.py     # 生成 index.single.html
```

> ⚠️ **为什么只拷 `index.html` 打不开?**
> 因为 `index.html` 引用了同目录的 `style.css`(样式)、`charts.js`(图表库)、`app.js`(逻辑)、`fonts/*.woff2`(字体)、`favicon.*`(图标)。只拷 HTML 会丢样式和全部功能。要单独分发,请用 **`index.single.html`**;要部署网站,请上传**整个目录**。

## 部署上线

### A. 不买域名(免费,最快被看到)

| 方式 | 说明 |
| --- | --- |
| **GitHub Pages** | 建仓库 → 上传整个目录 → Settings → Pages 开启 → 得到 `https://<用户名>.github.io/<仓库名>/` |
| **Netlify / Vercel / Cloudflare Pages** | 注册后把整个文件夹**拖拽上传**,自动获得 `xxx.netlify.app` / `xxx.vercel.app` / `xxx.pages.dev` 免费地址 |
| **局域网分享** | 本机运行 `python -m http.server 8000`,同一 WiFi 的人访问 `http://你的内网IP:8000` |
| **临时公网链接** | 安装 [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/),运行 `cloudflared tunnel --url http://localhost:8000`,得到一个临时 `https://xxx.trycloudflare.com` 地址(本机需开着) |
| **直接发文件** | 把 `index.single.html` 通过微信/邮件发给对方,对方双击即可用(最简单,零成本) |

### B. 买域名(长期正式用)

1. 选一个静态托管(见上表或下表),把**整个目录**上传;
2. 在托管平台设置里添加「自定义域名」,平台会给出一个 CNAME 目标地址;
3. 到域名服务商的 DNS 解析里加一条 **CNAME** 记录(例如 `www` → `你的站点.netlify.app`);
4. 开启 HTTPS(平台自动签发免费证书)。

| 平台 | 备注 |
| --- | --- |
| **GitHub Pages** | 免费、稳定,`username.github.io`;绑定域名在仓库 Settings → Pages |
| **Netlify / Vercel / Cloudflare Pages** | 免费额度够用,支持拖拽部署与自动 HTTPS |
| **腾讯云 COS / 阿里云 OSS** | 开启静态网站托管后上传;国内访问快,但**绑定国内域名需先 ICP 备案** |

> 域名只是"名字",必须绑定到托管平台才能被访问;不买域名也完全可以用平台免费子域名。

## Python 脚本(可选)

`fetch_weather.py` 用 **纯标准库** 调用同一组公开 API,适合离线取数 / 批量下载(网页版不需要它):

```bash
# 单个城市 JSON(默认)
python fetch_weather.py 北京 --start 2026-01-01 --end 2026-01-31

# 单城市 CSV / SVG
python fetch_weather.py 北京 --start 2026-10-01 --end 2026-10-07 --format csv  --out beijing.csv
python fetch_weather.py 北京 --start 2026-10-01 --end 2026-10-07 --format svg  --out beijing.svg

# 多城市对比 CSV / SVG / JSON
python fetch_weather.py 北京 上海 广州 --start 2026-11-01 --end 2026-11-07 --format csv --out compare.csv
```

## 文件结构

```
weather-site/
├── index.html          # 页面(需与下面文件放在同一目录)
├── index.single.html   # 单文件版:样式/脚本/字体/图标全部内联,可单独分发
├── build_single.py     # 生成 index.single.html 的打包脚本
├── style.css           # 样式(浅色/深色主题,Inter 字体)
├── charts.js           # 轻量 SVG 图表库(零依赖)+ SVG 导出
├── app.js              # 主逻辑:API 调用 / 中国AQI计算 / 对比 / 下载 / 主题
├── fetch_weather.py    # Python 命令行取数工具(可选)
├── fonts/              # Inter 字体(本地打包,离线可用)
├── favicon.svg         # 网页图标(SVG)
├── favicon.png         # 网页图标(PNG)
├── apple-touch-icon.png# iOS 主屏图标
└── README.md
```

## 数据说明

- **来源**:[Open-Meteo](https://open-meteo.com/) 公开 API
  - 天气:ECMWF 等数值模式;历史为 ERA5 再分析(自 1940 年)
  - 空气质量:CAMS(全球)与 CAMS Europe
- **许可**:CC BY 4.0,使用数据请注明 Open-Meteo
- **中国 AQI** 依据《环境空气质量指数(AQI)技术规定》(HJ 633-2012)按 24 小时均值口径估算,CO 由 µg/m³ 换算为 mg/m³;与官方实时 AQI 可能存在差异
- **限制**:
  - 空气质量历史数据各地点起始时间不同(多为 2022 年后),更早时段显示为无数据
  - 长时间跨度(>1 年)仅加载 PM2.5 / PM10 / 美国 AQI 以减小传输体积
  - 免费接口按 IP 限流(约 600 次/分钟),正常使用不受影响

## FAQ

**Q: 这是纯静态网页吗?**
A: 是。没有服务器端代码、没有数据库、不需要安装任何运行时;所有数据由浏览器直接请求 Open-Meteo。所谓"打开网页"只需要能加载 HTML/CSS/JS 文件。

**Q: 为什么只拷 `index.html` 打不开?**
A: 它依赖同目录的 CSS / JS / 字体 / 图标文件(相对路径)。请整目录部署,或使用单文件版 `index.single.html`。

**Q: 买域名后别人怎么访问?**
A: 域名只负责"名字",还需要把文件放到静态托管(GitHub Pages / Netlify / 对象存储等),再把域名的 CNAME 记录指向托管地址,并开启 HTTPS 即可。

**Q: 没有域名,别人能访问吗?**
A: 可以:用 GitHub Pages / Netlify 等免费子域名;局域网内直接分享 IP;用 cloudflared/ngrok 生成临时公网链接;或直接把 `index.single.html` 发给对方双击打开。

**Q: 用 `file://` 双击打开时数据能加载吗?**
A: 现代社会浏览器(Chrome / Edge / Firefox 等)通常可以;个别浏览器或安全设置可能限制跨域请求,遇到空白数据请改用 `python -m http.server` 或部署到托管平台。
