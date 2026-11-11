#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_weather.py —— 用 Python 调用 Open-Meteo 公开天气 API(与网页版同一数据源)

功能:
  · 任意城市(支持中文 / 英文)、任意时间段
    - 天气历史(再分析 ERA5)自 1940-01-01,预报 16 天
    - 空气质量(CAMS)历史自 2021-09-27(各地点实际起点不同),预报约 5 天
  · 输出 JSON / CSV / SVG,支持多城市对比
  · 仅用 Python 标准库,无需安装任何依赖(3.8+)

用法示例:
  python fetch_weather.py 北京 --start 2026-01-01 --end 2026-01-31
  python fetch_weather.py 北京 --start 2026-01-01 --end 2026-01-31 --format csv --out beijing.csv
  python fetch_weather.py 北京 上海 广州 --start 2026-11-01 --end 2026-11-07 --format csv --out compare.csv
  python fetch_weather.py 北京 --start 2026-10-01 --end 2026-10-07 --format svg --out beijing.svg
  python fetch_weather.py 北京 上海 --start 2026-10-01 --end 2026-10-07 --format svg --out compare.svg
"""
import argparse
import json
import math
import re
import sys
import urllib.parse
import urllib.request
from datetime import date, timedelta

GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
UA = {"User-Agent": "Mozilla/5.0 weather-cli/1.0"}
WEATHER_MIN = date(1940, 1, 1)
AQ_START = date(2021, 9, 27)
DAILY_VARS = "temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum"
AIR_FULL = "pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide,us_aqi"
AIR_LITE = "pm2_5,pm10,us_aqi"
PALETTE = ["#2563eb", "#e2574c", "#16a34a", "#f59e0b", "#8b5cf6", "#0ea5e9", "#ec4899", "#14b8a6"]

# 中国 AQI(HJ 633-2012)分段线性计算表:[污染物, 浓度断点(CO 为 mg/m³)]
CN_BPS = [
    ("pm25", [0, 35, 75, 115, 150, 250, 350, 500]),
    ("pm10", [0, 50, 150, 250, 350, 420, 500, 600]),
    ("so2", [0, 50, 150, 475, 800, 1600, 2100, 2620]),
    ("no2", [0, 40, 80, 180, 280, 565, 750, 940]),
    ("o3", [0, 100, 160, 215, 265, 800]),
    ("co", [0, 2, 4, 14, 24, 36, 48, 60]),
]
CN_ILO = [0, 50, 100, 150, 200, 300, 400, 500]
AQI_LEVELS = [
    (50, "优", "#00b050"), (100, "良", "#e5b800"), (150, "轻度污染", "#ff7e00"),
    (200, "中度污染", "#ef4444"), (300, "重度污染", "#99004d"), (10 ** 9, "严重污染", "#7e0023"),
]


def fetch(url: str) -> dict:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def geocode(name: str) -> dict:
    url = f"{GEO_URL}?name={urllib.parse.quote(name)}&count=5&language=zh&format=json"
    j = fetch(url)
    res = j.get("results") or []
    if not res:
        return None
    r = res[0]
    return {
        "name": r.get("name", name),
        "admin1": r.get("admin1") or "",
        "country": r.get("country") or "",
        "lat": r["latitude"],
        "lon": r["longitude"],
        "tz": r.get("timezone") or "",
    }


def compute_cn_aqi(pm25=None, pm10=None, so2=None, no2=None, o3=None, co=None):
    """按 HJ 633-2012 计算中国 AQI(co 单位为 mg/m³)。任一污染物缺失则不参与。"""
    c = {"pm25": pm25, "pm10": pm10, "so2": so2, "no2": no2, "o3": o3, "co": co}
    best = None
    for key, bp in CN_BPS:
        v = c.get(key)
        if v is None:
            continue
        i = len(bp) - 2
        for j in range(len(bp) - 1):
            if v <= bp[j + 1]:
                i = j
                break
        iaqi = (CN_ILO[i + 1] - CN_ILO[i]) / (bp[i + 1] - bp[i]) * (v - bp[i]) + CN_ILO[i]
        if best is None or iaqi > best:
            best = iaqi
    return round(best) if best is not None else None


def aqi_level(v):
    for mx, label, color in AQI_LEVELS:
        if v <= mx:
            return label, color
    return "严重污染", "#7e0023"


def fetch_weather(city, s: date, e: date):
    today = date.today()
    t92 = today - timedelta(days=92)
    with_hourly = (e - s).days + 1 <= 10
    parts = []
    if s <= today - timedelta(days=6):
        a_end = min(e, today - timedelta(days=6))
        extra = "&hourly=temperature_2m" if with_hourly else ""
        parts.append(fetch(
            f"{ARCHIVE_URL}?latitude={city['lat']}&longitude={city['lon']}"
            f"&start_date={s}&end_date={a_end}&daily={DAILY_VARS}{extra}&timezone=auto"))
    if e > today - timedelta(days=6):
        past = max(0, min(92, (today - max(s, t92)).days))
        fore = max(0, min(16, (e - today).days))
        extra = "&hourly=temperature_2m" if with_hourly else ""
        url = (f"{FORECAST_URL}?latitude={city['lat']}&longitude={city['lon']}"
               f"&past_days={past}&forecast_days={fore}&daily={DAILY_VARS}{extra}&timezone=auto")
        try:
            parts.append(fetch(url))
        except Exception:
            if past == 0 and fore > 0:
                parts.append(fetch(url.replace("past_days=0", "past_days=1")))
            else:
                raise
    daily = {"time": [], "tmax": [], "tmin": [], "tmean": [], "precip": []}
    hourly = {"time": [], "temp": []} if with_hourly else None
    seen_d, seen_h = set(), set()
    for p in parts:
        d = p.get("daily") or {}
        for i, t in enumerate(d.get("time") or []):
            if t < s.isoformat() or t > e.isoformat() or t in seen_d:
                continue
            seen_d.add(t)
            daily["time"].append(t)
            daily["tmax"].append(d.get("temperature_2m_max", [None] * (i + 1))[i])
            daily["tmin"].append(d.get("temperature_2m_min", [None] * (i + 1))[i])
            daily["tmean"].append(d.get("temperature_2m_mean", [None] * (i + 1))[i])
            daily["precip"].append(d.get("precipitation_sum", [None] * (i + 1))[i])
        if hourly is not None:
            h = p.get("hourly") or {}
            for i, t in enumerate(h.get("time") or []):
                if t[:10] < s.isoformat() or t[:10] > e.isoformat() or t in seen_h:
                    continue
                seen_h.add(t)
                hourly["time"].append(t)
                arr = h.get("temperature_2m") or []
                hourly["temp"].append(arr[i] if i < len(arr) else None)
    return daily, hourly, (parts[0].get("timezone") if parts else ""), parts


def fetch_air(city, s: date, e: date):
    today = date.today()
    t92 = today - timedelta(days=92)
    notes = []
    if s < AQ_START:
        notes.append(f"空气质量历史数据自 {AQ_START} 起开放(不同地点实际起始时间不同)")
        s = AQ_START
    aq_max_end = today + timedelta(days=5)
    if e > aq_max_end:
        notes.append(f"空气质量预报最多约 5 天(至 {aq_max_end})")
    if s > aq_max_end:
        notes.append("所选时段超出空气质量预报范围")
        return None, notes, []
    if s > e:
        notes.append("所选区间早于空气质量数据起始时间,无空气质量数据")
        return None, notes, []
    lite = (e - s).days + 1 > 366
    vars_ = AIR_LITE if lite else AIR_FULL
    if lite:
        notes.append("时间跨度超过 1 年,仅加载 PM2.5 / PM10 / 美国 AQI")
    parts = []
    if s <= today - timedelta(days=3):
        a_end = min(e, today - timedelta(days=3))
        try:
            parts.append(fetch(
                f"{AIR_URL}?latitude={city['lat']}&longitude={city['lon']}"
                f"&start_date={s}&end_date={a_end}&hourly={vars_}&timezone=auto"))
        except Exception as err:
            notes.append("空气质量历史数据请求失败:" + str(err))
    if e > today - timedelta(days=3):
        past = max(0, min(92, (today - max(s, t92)).days))
        fore = max(0, min(5, (e - today).days))
        url = (f"{AIR_URL}?latitude={city['lat']}&longitude={city['lon']}"
               f"&past_days={past}&forecast_days={fore}&hourly={vars_}&timezone=auto")
        try:
            parts.append(fetch(url))
        except Exception as err:
            if past == 0 and fore > 0:
                try:
                    parts.append(fetch(url.replace("past_days=0", "past_days=1")))
                except Exception as e2:
                    notes.append("空气质量数据请求失败:" + str(e2))
            else:
                notes.append("空气质量数据请求失败:" + str(err))
    hourly = {"time": [], "pm25": [], "pm10": [], "no2": [], "so2": [], "o3": [], "co": [], "usAqi": []}
    mp = {"pm2_5": "pm25", "pm10": "pm10", "nitrogen_dioxide": "no2",
          "sulphur_dioxide": "so2", "ozone": "o3", "carbon_monoxide": "co", "us_aqi": "usAqi"}
    seen = set()
    for p in parts:
        h = p.get("hourly") or {}
        for i, t in enumerate(h.get("time") or []):
            if t[:10] < s.isoformat() or t[:10] > e.isoformat() or t in seen:
                continue
            seen.add(t)
            hourly["time"].append(t)
            for src, dst in mp.items():
                arr = h.get(src) or []
                hourly[dst].append(arr[i] if i < len(arr) else None)
    if hourly["time"]:
        first = next((i for i, v in enumerate(hourly["pm25"]) if v is not None), -1)
        if first > 0:
            notes.append(f"该地点空气质量数据实际自 {hourly['time'][first][:10]} 起可用")
        if first == -1:
            notes.append("该地点/时段无空气质量数据")
    elif not notes:
        notes.append("该地点/时段无空气质量数据")
    return hourly, notes, parts


def daily_agg(hourly):
    """小时数据 -> 日均值 + 中国 AQI"""
    out = {"time": [], "pm25": [], "pm10": [], "no2": [], "so2": [], "o3": [], "co": [], "usAqi": [], "cnAqi": []}
    if not hourly or not hourly["time"]:
        return out
    keys = ["pm25", "pm10", "no2", "so2", "o3", "co"]
    acc = {}
    for i, t in enumerate(hourly["time"]):
        day = t[:10]
        a = acc.setdefault(day, {"sum": {k: 0.0 for k in keys}, "cnt": {k: 0 for k in keys}, "us": [0.0, 0]})
        for k in keys:
            v = hourly[k][i]
            if v is not None:
                a["sum"][k] += v
                a["cnt"][k] += 1
        u = hourly["usAqi"][i]
        if u is not None:
            a["us"][0] += u
            a["us"][1] += 1
    for day, a in acc.items():
        out["time"].append(day)
        for k in keys:
            out[k].append(a["sum"][k] / a["cnt"][k] if a["cnt"][k] else None)
        out["usAqi"].append(round(a["us"][0] / a["us"][1], 1) if a["us"][1] else None)
        co_mg = a["sum"]["co"] / a["cnt"]["co"] / 1000 if a["cnt"]["co"] else None
        out["cnAqi"].append(compute_cn_aqi(
            pm25=out["pm25"][-1], pm10=out["pm10"][-1], no2=out["no2"][-1],
            so2=out["so2"][-1], o3=out["o3"][-1], co=co_mg))
    return out


def get_city_data(city, s: date, e: date):
    daily, hourly, tz, raw_w = fetch_weather(city, s, e)
    air_hourly, air_notes, raw_a = fetch_air(city, s, e)
    air_daily = daily_agg(air_hourly)
    return {
        "city": city, "start": s.isoformat(), "end": e.isoformat(),
        "weather": {"daily": daily, "hourly": hourly, "timezone": tz, "raw": raw_w},
        "air": {"hourly": air_hourly, "daily": air_daily, "notes": air_notes, "raw": raw_a},
    }


# ================= 输出 =================
def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))


def nice_step(rng, target=5):
    if rng <= 0:
        return 1.0
    raw = rng / target
    mag = 10 ** math.floor(math.log10(raw))
    norm = raw / mag
    step = (1 if norm <= 1 else 2 if norm <= 2 else 2.5 if norm <= 2.5 else 5 if norm <= 5 else 10) * mag
    return step


def fmt_axis(v):
    if v == 0:
        return "0"
    a = abs(v)
    if a >= 1000:
        return f"{v/1000:.0f}k" if a >= 10000 else f"{v/1000:.1f}k"
    if a >= 100:
        return str(round(v))
    return str(round(v * 10) / 10)


def svg_chart(labels, series, width=960, height=300, y_label="", bands=None, title="", zero_base=False):
    """生成 SVG 折线/色带图。series: [{label,color,values,type(可选 band/bar),dash,width}]"""
    ml, mr, mb = 50.0, 16.0, 30.0
    content_top = 12.0
    if title:
        content_top += 22
    legend = [s for s in series if s.get("label")]
    if legend:
        content_top += math.ceil(len(legend) / 4) * 16 + 6
    plot_top = content_top + 6
    plot_w = width - ml - mr
    plot_h = max(height - plot_top - mb, 30.0)

    vals = []
    for s in series:
        for v in s["values"]:
            if v is None:
                continue
            if isinstance(v, (list, tuple)):
                vals += [v[0], v[1]]
            else:
                vals.append(v)
    if vals:
        lo = min(vals) - (max(vals) - min(vals)) * 0.08
        hi = max(vals) + (max(vals) - min(vals)) * 0.08
    else:
        lo, hi = 0.0, 1.0
    if zero_base:
        lo = min(0.0, lo)
    if not hi > lo:
        hi = lo + 1

    n = len(labels)
    def X(i):
        return ml + (plot_w / 2 if n <= 1 else i / (n - 1) * plot_w)
    def Y(v):
        return plot_top + plot_h - (v - lo) / (hi - lo) * plot_h

    out = []
    out.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">')
    out.append(f'<rect width="{width}" height="{height}" fill="#ffffff"/>')
    if bands:
        for b in bands:
            y_top = Y(max(b["from"], lo))
            y_bot = Y(min(b["to"], hi))
            if y_bot - y_top >= 0.5:
                out.append(f'<rect x="{ml}" y="{y_bot:.1f}" width="{plot_w}" height="{y_top - y_bot:.1f}" fill="{b["color"]}" opacity="0.10"/>')
                out.append(f'<text x="{width - mr - 4}" y="{y_bot + 11:.1f}" text-anchor="end" font-size="10" fill="{b["color"]}" opacity="0.8">{esc(b["label"])}</text>')
    step = nice_step(hi - lo)
    v = math.ceil(lo / step - 1e-9) * step
    while v <= hi + 1e-9:
        y = Y(v)
        out.append(f'<line x1="{ml}" y1="{y:.1f}" x2="{width - mr}" y2="{y:.1f}" stroke="#e2e8f0" stroke-width="1"/>')
        out.append(f'<text x="{ml - 6}" y="{y + 3.5:.1f}" text-anchor="end" font-size="11" fill="#64748b">{fmt_axis(v)}</text>')
        v += step
    if n > 0:
        every = max(1, math.ceil(n / max(3, math.floor(plot_w / 100))))
        idxs = list(range(0, n, every))
        if idxs[-1] != n - 1:
            idxs.append(n - 1)
        for i in idxs:
            x = X(i)
            out.append(f'<line x1="{x:.1f}" y1="{plot_top}" x2="{x:.1f}" y2="{plot_top + plot_h}" stroke="#e2e8f0" stroke-width="1"/>')
            out.append(f'<text x="{x:.1f}" y="{height - 9}" text-anchor="middle" font-size="11" fill="#64748b">{esc(labels[i])}</text>')
    out.append(f'<line x1="{ml}" y1="{plot_top + plot_h:.1f}" x2="{width - mr}" y2="{plot_top + plot_h:.1f}" stroke="#cbd5e1" stroke-width="1"/>')
    if title:
        out.append(f'<text x="{ml}" y="25" font-size="13" font-weight="700" fill="#334155">{esc(title)}</text>')
    if y_label:
        out.append(f'<text x="13" y="{plot_top + plot_h / 2:.1f}" transform="rotate(-90 13 {plot_top + plot_h / 2:.1f})" text-anchor="middle" font-size="11" fill="#64748b">{esc(y_label)}</text>')
    if legend:
        lx = ml
        for it in legend:
            w_est = 10 + 5 + 12 + sum(11 if ord(ch) > 255 else 7 for ch in str(it["label"]))
            if lx + w_est > width - mr and lx > ml:
                lx = ml
            out.append(f'<rect x="{lx}" y="{content_top - 14}" width="10" height="10" rx="2" fill="{it["color"]}"/>')
            out.append(f'<text x="{lx + 14}" y="{content_top - 5}" font-size="11" fill="#334155">{esc(it["label"])}</text>')
            lx += w_est
    if not n:
        out.append(f'<text x="{width/2}" y="{plot_top + plot_h/2}" text-anchor="middle" font-size="14" fill="#64748b">该时段无数据</text>')
    for s in series:
        vals_ = s["values"]
        if s.get("type") == "band":
            dtop, dbot = [], []
            for i, v in enumerate(vals_):
                if v:
                    dtop.append(f'{"L" if dtop else "M"}{X(i):.1f} {Y(v[1]):.1f}')
            for i in range(len(vals_) - 1, -1, -1):
                v = vals_[i]
                if v:
                    dbot.append(f"L{X(i):.1f} {Y(v[0]):.1f}")
            if dtop:
                out.append(f'<path d="{"".join(dtop)}{"".join(dbot)}Z" fill="{s["color"]}" opacity="{s.get("opacity", 0.16)}"/>')
        elif s.get("type") == "bar":
            bw = min(plot_w / max(n, 1) * 0.62, 28)
            for i, v in enumerate(vals_):
                if v is None:
                    continue
                out.append(f'<rect x="{X(i) - bw/2:.1f}" y="{Y(v):.1f}" width="{bw:.1f}" height="{max(Y(lo) - Y(v), 0.5):.1f}" rx="1.5" fill="{s["color"]}" opacity="{s.get("opacity", 0.8)}"/>')
        else:
            d, started = "", False
            for i, v in enumerate(vals_):
                if v is None:
                    started = False
                    continue
                d += ("L" if started else "M") + f"{X(i):.1f} {Y(v):.1f}"
                started = True
            if d:
                out.append(f'<path d="{d}" fill="none" stroke="{s["color"]}" stroke-width="{s.get("width", 2)}" stroke-dasharray="{s.get("dash", "")}" stroke-linejoin="round" stroke-linecap="round"/>')
    out.append("</svg>")
    return "".join(out)


def svg_for_single(data, label_fmt):
    w = data["weather"]["daily"]
    a = data["air"]["daily"]
    city = data["city"]
    color = city.get("color", PALETTE[0])
    dates = sorted(set(w["time"]) | set(a["time"]))
    labels = [label_fmt(t) for t in dates]

    def map_to(arr, own_time):
        m = {t: i for i, t in enumerate(own_time)}
        return [arr[m[t]] if t in m else None for t in dates]

    temp_series = [
        {"label": "最低 / 最高气温", "color": color, "type": "band",
         "values": [[tmin, tmax] if tmin is not None and tmax is not None else None
                    for tmin, tmax in zip(map_to(w["tmin"], w["time"]), map_to(w["tmax"], w["time"]))]},
        {"label": "日平均气温", "color": color, "values": map_to(w["tmean"], w["time"]), "width": 2.2},
    ]
    aqi_series = [
        {"label": "中国AQI(估算)", "color": color, "values": map_to(a["cnAqi"], a["time"]), "width": 2.4},
        {"label": "美国AQI", "color": "#94a3b8", "values": map_to(a["usAqi"], a["time"]), "width": 1.6, "dash": "5 4"},
    ]
    pm_series = [
        {"label": "PM2.5", "color": "#f59e0b", "values": map_to(a["pm25"], a["time"]), "width": 1.8},
        {"label": "PM10", "color": "#8b5cf6", "values": map_to(a["pm10"], a["time"]), "width": 1.8},
    ]
    bands = []
    prev = 0
    for mx, lbl, c in AQI_LEVELS:
        bands.append({"from": prev, "to": min(mx, 500), "label": lbl, "color": c})
        prev = mx
    charts = [
        (svg_chart(labels, temp_series, height=330, y_label="°C", title=f"{city['name']} 温度变化"), 330),
        (svg_chart(labels, aqi_series, height=300, y_label="AQI", bands=bands, zero_base=True, title="空气质量指数(AQI)"), 300),
        (svg_chart(labels, pm_series, height=300, y_label="µg/m³", zero_base=True, title="PM2.5 / PM10(日均)"), 300),
    ]
    return stack_svg(charts)


def svg_for_compare(datas, label_fmt):
    def union_labels():
        s = set()
        for d in datas:
            s.update(d["weather"]["daily"]["time"])
        return sorted(s)

    labels_union = union_labels()
    labels = [label_fmt(t) for t in labels_union]

    def map_to(arr, own_time):
        m = {t: i for i, t in enumerate(own_time)}
        return [arr[m[t]] if t in m else None for t in labels_union]

    temp_series = [{"label": d["city"]["name"], "color": d["city"].get("color", PALETTE[i]),
                    "values": map_to(d["weather"]["daily"]["tmean"], d["weather"]["daily"]["time"]), "width": 2.2}
                   for i, d in enumerate(datas)]
    aqi_series = [{"label": d["city"]["name"], "color": d["city"].get("color", PALETTE[i]),
                   "values": map_to(d["air"]["daily"]["cnAqi"], d["air"]["daily"]["time"]), "width": 2.2}
                  for i, d in enumerate(datas)]
    pm_series = [{"label": d["city"]["name"], "color": d["city"].get("color", PALETTE[i]),
                  "values": map_to(d["air"]["daily"]["pm25"], d["air"]["daily"]["time"]), "width": 2.2}
                 for i, d in enumerate(datas)]
    bands = []
    prev = 0
    for mx, lbl, color in AQI_LEVELS:
        bands.append({"from": prev, "to": min(mx, 500), "label": lbl, "color": color})
        prev = mx
    charts = [
        (svg_chart(labels, temp_series, height=300, y_label="°C", title="平均气温对比"), 300),
        (svg_chart(labels, aqi_series, height=300, y_label="AQI", bands=bands, zero_base=True, title="中国AQI对比(估算)"), 300),
        (svg_chart(labels, pm_series, height=300, y_label="µg/m³", zero_base=True, title="PM2.5 对比"), 300),
    ]
    return stack_svg(charts)


def stack_svg(charts):
    """charts: [(svg 字符串, 高度), ...] → 纵向拼接为一张 SVG"""
    gap = 30
    w = 960
    total = sum(h for _, h in charts) + gap * max(0, len(charts) - 1)
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {total}" width="{w}" height="{total}">',
           f'<rect width="{w}" height="{total}" fill="#ffffff"/>']
    y = 0
    for svg_str, h in charts:
        inner = re.sub(r"^<svg[^>]*>", f'<g transform="translate(0,{y})">', svg_str, count=1)
        inner = re.sub(r"</svg>$", "</g>", inner)
        out.append(inner)
        y += h + gap
    out.append("</svg>")
    return "".join(out)


def label_fmt_maker(times):
    cross_year = len(times) > 1 and times[0][:4] != times[-1][:4]
    return (lambda t: t[2:10]) if cross_year else (lambda t: t[5:10])


CSV_HEADER = ["日期", "最低温度(°C)", "最高温度(°C)", "平均温度(°C)", "降水量(mm)",
              "PM2.5(µg/m³)", "PM10(µg/m³)", "NO2(µg/m³)", "SO2(µg/m³)", "O3(µg/m³)", "CO(µg/m³)",
              "美国AQI", "中国AQI(估算)"]


def csv_text(rows):
    lines = [",".join('"' + str(c).replace('"', '""') + '"' if ("," in str(c) or '"' in str(c)) else str(c) for c in r) for r in rows]
    return "\ufeff" + "\r\n".join(lines)


def build_csv(datas, wide):
    if wide:
        d = datas[0]
        w, a = d["weather"]["daily"], d["air"]["daily"]
        wm = {t: i for i, t in enumerate(w["time"])}
        am = {t: i for i, t in enumerate(a["time"])}
        dates = sorted(set(w["time"]) | set(a["time"]))
        rows = [CSV_HEADER]
        for t in dates:
            wi, ai = wm.get(t), am.get(t)
            g = lambda arr, i: (arr[i] if arr and i is not None and arr[i] is not None else "")
            rows.append([t, g(w["tmin"], wi), g(w["tmax"], wi), g(w["tmean"], wi), g(w["precip"], wi),
                         g(a["pm25"], ai), g(a["pm10"], ai), g(a["no2"], ai), g(a["so2"], ai), g(a["o3"], ai),
                         g(a["co"], ai), g(a["usAqi"], ai), g(a["cnAqi"], ai)])
        return csv_text(rows)
    rows = [["城市"] + CSV_HEADER]
    for d in datas:
        w, a = d["weather"]["daily"], d["air"]["daily"]
        wm = {t: i for i, t in enumerate(w["time"])}
        am = {t: i for i, t in enumerate(a["time"])}
        dates = sorted(set(w["time"]) | set(a["time"]))
        for t in dates:
            wi, ai = wm.get(t), am.get(t)
            g = lambda arr, i: (arr[i] if arr and i is not None and arr[i] is not None else "")
            rows.append([d["city"]["name"], t, g(w["tmin"], wi), g(w["tmax"], wi), g(w["tmean"], wi),
                         g(w["precip"], wi), g(a["pm25"], ai), g(a["pm10"], ai), g(a["no2"], ai),
                         g(a["so2"], ai), g(a["o3"], ai), g(a["co"], ai), g(a["usAqi"], ai), g(a["cnAqi"], ai)])
    return csv_text(rows)


def main():
    ap = argparse.ArgumentParser(description="用 Python 调用 Open-Meteo 公开天气 API 下载天气/空气质量数据(JSON/CSV/SVG)")
    ap.add_argument("cities", nargs="+", help="城市名,支持中文/英文;多个城市以空格分隔用于对比")
    ap.add_argument("--start", required=True, help="开始日期 YYYY-MM-DD")
    ap.add_argument("--end", required=True, help="结束日期 YYYY-MM-DD")
    ap.add_argument("--format", choices=["json", "csv", "svg"], default="json", help="输出格式(默认 json)")
    ap.add_argument("--out", help="输出文件路径(默认:城市名_日期范围_weather.扩展名)")
    args = ap.parse_args()

    try:
        s = date.fromisoformat(args.start)
        e = date.fromisoformat(args.end)
    except ValueError:
        sys.exit("日期格式应为 YYYY-MM-DD")
    if s > e:
        sys.exit("开始日期不能晚于结束日期")
    if s < WEATHER_MIN:
        sys.exit(f"天气历史最早自 {WEATHER_MIN}")
    today = date.today()
    if e > today + timedelta(days=16):
        sys.exit(f"天气预报最多 16 天(至 {today + timedelta(days=16)})")

    cities = []
    for name in args.cities:
        print(f"正在定位城市:{name} …")
        g = geocode(name)
        if not g:
            sys.exit(f"未找到城市:{name},请尝试其它写法")
        print(f"  定位到 {g['name']} ({g['admin1']}, {g['country']})  {g['lat']},{g['lon']}")
        cities.append(g)
    for i, c in enumerate(cities):
        c["color"] = PALETTE[i % len(PALETTE)]

    print(f"正在下载 {s} ~ {e} 的天气与空气质量数据 …")
    datas = [get_city_data(c, s, e) for c in cities]

    fmt = args.format
    base_name = "-".join(c["name"] for c in cities) + f"_{args.start}_{args.end}_weather"
    if fmt == "json":
        path = args.out or base_name + ".json"
        doc = datas[0] if len(datas) == 1 else {"cities": datas, "source": "Open-Meteo", "license": "CC BY 4.0"}
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, indent=2)
    elif fmt == "csv":
        path = args.out or base_name + ".csv"
        with open(path, "w", encoding="utf-8-sig", newline="") as f:
            f.write(build_csv(datas, wide=(len(datas) == 1)))
    else:
        path = args.out or base_name + ".svg"
        lf = label_fmt_maker(datas[0]["weather"]["daily"]["time"])
        svg = svg_for_single(datas[0], lf) if len(datas) == 1 else svg_for_compare(datas, lf)
        with open(path, "w", encoding="utf-8") as f:
            f.write(svg)
    print(f"完成!已保存:{path}")


if __name__ == "__main__":
    main()
