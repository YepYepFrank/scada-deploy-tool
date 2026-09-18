#!/usr/bin/env bash
# 在 PVE 宿主上跑:把 tb-sim.py 装进 CT 110,生成设备配置(令牌与基准值只在容器内落地,权限 600),建 systemd 服务,并给 TB 加 7 天 TTL。
set -euo pipefail
CT=110
x() { pct exec $CT -- bash -c "$1"; }
x 'mkdir -p /opt/sim'; pct push $CT /root/ct110-sim.py /opt/sim/tb-sim.py
x 'chmod 755 /opt/sim/tb-sim.py'
echo "== 生成 /opt/sim/devices.json(SSP1_/SSP2_/PDR 设备,已有 ts key 的最后一次值)"
x 'runuser -u postgres -- psql -Atc "
select json_object_agg(name, json_build_object('"'"'token'"'"', token, '"'"'keys'"'"', keys)) from (
  select d.name, c.credentials_id as token,
         json_object_agg(k.key, coalesce(to_json(l.dbl_v), to_json(l.long_v), to_json(l.bool_v), to_json(l.str_v))) as keys
  from device d
  join device_credentials c on c.device_id=d.id and c.credentials_type='"'"'ACCESS_TOKEN'"'"'
  join ts_kv_latest l on l.entity_id=d.id
  join key_dictionary k on k.key_id=l.key
  where d.name ~ '"'"'^(SSP1_|SSP2_|PDR)'"'"' and (l.dbl_v is not null or l.long_v is not null or l.bool_v is not null or l.str_v is not null)
  group by d.name, c.credentials_id) s" thingsboard > /opt/sim/devices.json; chmod 600 /opt/sim/devices.json; python3 -c "import json;d=json.load(open(\"/opt/sim/devices.json\"));print(\"devices\",len(d),\"keys\",sum(len(v[\"keys\"]) for v in d.values()))"'
echo "== systemd tb-sim"
x 'cat > /etc/systemd/system/tb-sim.service <<EOF
[Unit]
Description=TB device data simulator for SSP1/SSP2/PDR devices (CT 110, 2026-09-18)
After=thingsboard.service
[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/sim/tb-sim.py
Restart=always
RestartSec=15
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload; systemctl enable --now tb-sim; sleep 8; systemctl is-active tb-sim; journalctl -u tb-sim -n 3 --no-pager | cut -c1-140'
echo "== TB TTL 7 天(与镜像一致)"
x 'f=/etc/thingsboard/conf/thingsboard.conf; grep -q "^export SQL_TTL_TS_ENABLED" $f || { cp -p $f $f.bak-20260918; printf "\n# 2026-09-18 与镜像 111 一致:时序 7 天 TTL(模拟器造数,20G 盘)\nexport SQL_TTL_TS_ENABLED=true\nexport SQL_TTL_TS_TS_KEY_VALUE_TTL=604800\nexport SQL_TTL_TS_EXECUTION_INTERVAL=3600000\n" >> $f; systemctl restart thingsboard; for i in $(seq 1 40); do sleep 5; curl -sf -o /dev/null http://127.0.0.1:8080/ && { echo "TB up after $((i*5))s"; break; }; done; }; grep -E "^export SQL_TTL" $f'
