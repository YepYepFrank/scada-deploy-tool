#!/usr/bin/env bash
# 在 PVE 宿主(192.168.10.2)上以 root 运行。把 /root/thingsboard_new_backup.sql.gz 恢复进 CT 110(192.168.20.60)
# 的 TB 库,并把 CT 111(镜像)的 kzserver 复制到 CT 110 配好。
# 用法: bash ct110-restore.sh <phase>   phase ∈ preflight | restore | kz | verify | rollback
set -euo pipefail
CT=110; SRC=111
GZ=/root/thingsboard_new_backup.sql.gz
GZ_SHA=4800d97670e9c4818a88ffbce9a37df99c8cf9a1c65e20d3c3303b6c8a109071
STAMP=$(date +%Y%m%d-%H%M)
phase=${1:-preflight}
x() { pct exec $CT -- bash -c "$1"; }      # 在 CT 110 里跑
xs() { pct exec $SRC -- bash -c "$1"; }    # 在 CT 111 里跑

case $phase in
preflight)
  echo "== 宿主"; hostname; pveversion; pct status $CT; pct status $SRC
  echo "== 备份文件"; ls -la $GZ; echo "$GZ_SHA  $GZ" | sha256sum -c
  echo "== CT $CT 环境"
  x 'grep -E "^(PRETTY_NAME)" /etc/os-release; java -version 2>&1 | head -1; psql --version; dpkg-query -W thingsboard; df -h / | tail -1; free -m | head -2'
  x 'systemctl is-active thingsboard postgresql redis-server tb-api-admin 2>&1 | paste -sd" "; ls /opt 2>/dev/null; ls /opt/kzserver 2>/dev/null || echo "(无 /opt/kzserver)"'
  echo "== CT $CT 现有库"
  x 'runuser -u postgres -- psql -Atc "select datname, pg_size_pretty(pg_database_size(datname)) from pg_database where datistemplate=false"'
  x 'runuser -u postgres -- psql -Atc "select schema_version, product from tb_schema_settings" thingsboard 2>/dev/null || echo "(thingsboard 库不存在或无 tb_schema_settings)"'
  x 'runuser -u postgres -- psql -Atc "select authority, email from tb_user order by 1" thingsboard 2>/dev/null'
  x 'grep -E "^export (SPRING_DATASOURCE_URL|SPRING_DATASOURCE_USERNAME|SQL_POSTGRES_TS_KV_PARTITIONING|SQL_TTL)" /etc/thingsboard/conf/thingsboard.conf | sed -E "s/(PASSWORD=).*/\1***/"'
  echo "== CT $SRC 的 kzserver(来源)"
  xs 'ls -la /opt/kzserver; systemctl cat tb-api-admin | grep -vE "^#"; runuser -u postgres -- psql -Atc "select schema_version from tb_schema_settings" thingsboard'
  xs 'sed -E "s/(password:\s*).*/\1***/I; s/(secret:\s*).*/\1***/I" /opt/kzserver/application-gz.yml 2>/dev/null || ls /opt/kzserver/*.yml'
  ;;

restore)
  echo "$GZ_SHA  $GZ" | sha256sum -c
  pct push $CT $GZ /root/thingsboard_new_backup.sql.gz
  echo "== 停 TB(及 kz,如有)"
  x 'systemctl stop thingsboard; systemctl stop tb-api-admin 2>/dev/null || true; sleep 2'
  echo "== 备份现库 → /root/tb-before-restore-'$STAMP'.sql.gz"
  x "runuser -u postgres -- pg_dump thingsboard | gzip -6 > /root/tb-before-restore-$STAMP.sql.gz; ls -la /root/tb-before-restore-$STAMP.sql.gz"
  echo "== 重建 thingsboard 库"
  x 'runuser -u postgres -- psql -Atc "select pg_terminate_backend(pid) from pg_stat_activity where datname='"'"'thingsboard'"'"' and pid<>pg_backend_pid()" >/dev/null; runuser -u postgres -- psql -c "DROP DATABASE thingsboard"; runuser -u postgres -- psql -c "CREATE DATABASE thingsboard OWNER thingsboard"'
  echo "== 导入(去掉 pg_dump 16.10+ 的 \\restrict 行;错误计数在末尾)"
  x 'gunzip -c /root/thingsboard_new_backup.sql.gz | sed "/^\\\\restrict /d; /^\\\\unrestrict /d; s/OWNER TO postgres;/OWNER TO thingsboard;/" | runuser -u postgres -- psql -q -v ON_ERROR_STOP=0 thingsboard > /root/restore-'$STAMP'.log 2>&1; echo "ERROR 行数: $(grep -c ERROR /root/restore-'$STAMP'.log)"; grep -m 20 ERROR /root/restore-'$STAMP'.log || true'
  echo "== 导入后核对"
  x 'runuser -u postgres -- psql -Atc "select '"'"'schema '"'"'||schema_version from tb_schema_settings union all select '"'"'devices '"'"'||count(*) from device union all select '"'"'assets '"'"'||count(*) from asset union all select '"'"'rule_chains '"'"'||count(*) from rule_chain union all select '"'"'biz_key_cn '"'"'||count(*) from biz_key_cn" thingsboard'
  echo "== 版本对齐:包版本 vs 库 schema_version"
  x 'pkg=$(dpkg-query -W -f="\${Version}" thingsboard); sv=$(runuser -u postgres -- psql -Atc "select schema_version from tb_schema_settings" thingsboard); echo "pkg=$pkg schema=$sv"; if [ "$sv" != "4003001003" ] && echo "$pkg" | grep -q "^4.3.1"; then echo ">> 跑 upgrade.sh"; /usr/share/thingsboard/bin/install/upgrade.sh 2>&1 | tail -15; fi'
  echo "== 启动 TB,等 8080"
  x 'systemctl start thingsboard; for i in $(seq 1 60); do sleep 5; curl -sf -o /dev/null http://127.0.0.1:8080/ && { echo "TB up after $((i*5))s"; break; }; done; systemctl is-active thingsboard; grep -m5 -iE "schema|upgrade|ERROR" /var/log/thingsboard/thingsboard.log | tail -5 || true'
  ;;

kz)
  echo "== 从 CT $SRC 打包 kzserver(不带 *.bak-* 与日志)"
  xs 'cd / && tar czf /root/kzserver-from-111.tgz --exclude="*.bak-*" --exclude="*.log" --exclude="logs" opt/kzserver etc/systemd/system/tb-api-admin.service && ls -la /root/kzserver-from-111.tgz'
  pct pull $SRC /root/kzserver-from-111.tgz /root/kzserver-from-111.tgz
  pct push $CT /root/kzserver-from-111.tgz /root/kzserver-from-111.tgz
  echo "== CT $CT 解包 + 依赖(redis)"
  x 'cd / && tar xzf /root/kzserver-from-111.tgz && ls -la /opt/kzserver'
  x 'if ! command -v redis-server >/dev/null; then apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq redis-server; fi; systemctl enable --now redis-server; redis-cli ping'
  echo "== yml 原样使用(110/111 的 TB 库账号与 yml 一致,Redis 无密码)"
  x 'sed -E "s/(password:\s*).*/***/I" /opt/kzserver/application-gz.yml | grep -n -iE "url:|host:|port:|database:|username:|password:"'
  echo "== 起服务"
  x 'systemctl daemon-reload; systemctl enable --now tb-api-admin; for i in $(seq 1 24); do sleep 5; ss -ltn | grep -q ":8099 " && { echo "8099 up after $((i*5))s"; break; }; done; systemctl is-active tb-api-admin; journalctl -u tb-api-admin -n 15 --no-pager'
  ;;

verify)
  x 'ss -ltnp | grep -E ":(8080|8099|1883|6379|5432) " ; curl -s -o /dev/null -w "TB / %{http_code}\n" http://127.0.0.1:8080/; curl -s -o /dev/null -w "kz / %{http_code}\n" http://127.0.0.1:8099/kzserver/'
  x 'curl -s http://127.0.0.1:8080/v3/api-docs | grep -o "\"version\":\"[^\"]*\"" | head -1'
  x 'runuser -u postgres -- psql -Atc "select authority||'"'"' '"'"'||email from tb_user order by 1" thingsboard'
  ;;

rollback)
  f=$(x 'ls -t /root/tb-before-restore-*.sql.gz | head -1'); echo "回滚到 $f"
  x 'systemctl stop thingsboard; systemctl stop tb-api-admin 2>/dev/null || true'
  x 'runuser -u postgres -- psql -Atc "select pg_terminate_backend(pid) from pg_stat_activity where datname='"'"'thingsboard'"'"' and pid<>pg_backend_pid()" >/dev/null; runuser -u postgres -- psql -c "DROP DATABASE thingsboard"; runuser -u postgres -- psql -c "CREATE DATABASE thingsboard OWNER thingsboard"'
  x "gunzip -c $f | sed '/^\\\\restrict /d; /^\\\\unrestrict /d; s/OWNER TO postgres;/OWNER TO thingsboard;/' | runuser -u postgres -- psql -q thingsboard >/dev/null 2>&1; systemctl start thingsboard"
  ;;
*) echo "unknown phase $phase"; exit 1;;
esac
