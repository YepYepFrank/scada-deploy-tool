#!/usr/bin/env python3
"""CT 110 设备数据模拟器(2026-09-18):给 SSP1_/SSP2_/PDR 设备按各自已有的测点造数。
配置 /opt/sim/devices.json 由 SQL 从库里生成:{设备名: {"token": 设备接入令牌, "keys": {测点: 最后一次值}}}。
每 INTERVAL 秒用 HTTP 设备 API(POST /api/v1/{token}/telemetry)发一轮:
  - 浮点:基准值 × (1 + 3% 慢正弦漂移 + 1% 噪声),频率 F 只抖 ±0.03
  - 电度 / 电量类累计值(EP / EP- / EQ / EQ- / *kWh*):单调递增
  - 开关量 / 状态量(CB / COM / switch_state / *state* / *_ST / *Mode*):保持基准值不变
  - 字符串:原样
只读 devices.json,不写日志内容,失败只计数。"""
import json, math, random, time, urllib.request, sys

CFG = '/opt/sim/devices.json'
BASE = 'http://127.0.0.1:8080'
INTERVAL = 30
STATE_KEYS = {'CB', 'COM', 'switch_state', 'ATS_Main', 'ATS_UtilitySide', 'AutoMode'}
ENERGY_PREFIX = ('EP', 'EQ')


def is_state(k):
    lk = k.lower()
    return k in STATE_KEYS or 'state' in lk or lk.endswith('_st') or 'mode' in lk or lk.endswith('_fault') or lk.endswith('_err') or 'alarm' in lk


def is_energy(k, v):
    return isinstance(v, (int, float)) and (k.startswith(ENERGY_PREFIX) or 'kwh' in k.lower() or k.endswith('电量')) and abs(v) >= 1000


def gen(dev, key, base, t, phase):
    if isinstance(base, bool) or isinstance(base, str) or base is None:
        return base
    if is_state(key):
        return base
    if is_energy(key, base):
        return int(base + abs(hash((dev, key))) % 7 + 1)  # 每轮涨 1~7
    if key == 'F':
        return round(50 + 0.03 * math.sin(t / 600 + phase) + random.uniform(-0.01, 0.01), 3)
    if isinstance(base, int) and not isinstance(base, bool):
        if base == 0:
            return 0
        return int(round(base * (1 + 0.03 * math.sin(t / 900 + phase) + random.uniform(-0.01, 0.01))))
    if base == 0:
        return round(random.uniform(-0.5, 0.5), 2)
    return round(base * (1 + 0.03 * math.sin(t / 900 + phase) + random.uniform(-0.01, 0.01)), 3)


def main():
    with open(CFG) as f:
        devices = json.load(f)
    energy = {(d, k): v for d, c in devices.items() for k, v in c['keys'].items() if is_energy(k, v)}
    phases = {d: random.uniform(0, 6.28) for d in devices}
    print(f'sim: {len(devices)} devices, {sum(len(c["keys"]) for c in devices.values())} keys, every {INTERVAL}s', flush=True)
    tick = 0
    while True:
        t = time.time(); ok = fail = 0
        for name, c in devices.items():
            vals = {}
            for k, base in c['keys'].items():
                if (name, k) in energy:
                    energy[(name, k)] = gen(name, k, energy[(name, k)], t, phases[name])
                    vals[k] = energy[(name, k)]
                else:
                    vals[k] = gen(name, k, base, t, phases[name])
            body = json.dumps({'ts': int(t * 1000), 'values': vals}).encode()
            req = urllib.request.Request(f'{BASE}/api/v1/{c["token"]}/telemetry', data=body, headers={'Content-Type': 'application/json'})
            try:
                urllib.request.urlopen(req, timeout=10).read(); ok += 1
            except Exception:
                fail += 1
        tick += 1
        if tick % 20 == 1 or fail:
            print(f'tick {tick}: ok={ok} fail={fail}', flush=True)
        time.sleep(max(0, INTERVAL - (time.time() - t)))


if __name__ == '__main__':
    main()
