import json, os, sys, urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
TOPIC = os.environ.get("NTFY_TOPIC", "").strip()
FULL_LIMIT_MIN = 180   # 전체 조회가 이 시간(분) 넘게 비면 알림
FINE_LIMIT_MIN = 40    # 10분 조회가 이 시간(분) 넘게 비면 알림
REPEAT_MIN = 180       # 고장이 계속되면 이 간격(분)마다 다시 알림
WINDOW_MIN = 35        # 반복 알림 판정 폭 (30분마다 도는 감시 주기보다 조금 크게)

SITES = [("네이버", "data"), ("오늘의집", "ohouse/data")]


def to_dt(s):
    return datetime.strptime(s[:16], "%Y-%m-%dT%H:%M").replace(tzinfo=KST)


def newest_full(path):
    d = json.load(open(path, encoding="utf-8"))
    best = ""
    for rec in d.values():
        if isinstance(rec, dict):
            for t in rec:
                if len(t) >= 16 and t[4] == "-" and t > best:
                    best = t
    return best


PARTIAL_RATIO = 0.5   # 최근 전체 조회 상품 수가 지난 하루 최대치의 절반보다 적으면 "일부만 수집" 알림


def product_counts(path):
    """시각별로 몇 개 상품을 모았는지 센다 (키 = 채널_상품번호_옵션)"""
    d = json.load(open(path, encoding="utf-8"))
    counts = {}
    for key, rec in d.items():
        if not isinstance(rec, dict):
            continue
        parts = key.split("_")
        pid = parts[1] if len(parts) > 1 else key
        for t in rec:
            if len(t) >= 16 and t[4] == "-":
                counts.setdefault(t[:16], set()).add(pid)
    return {t: len(v) for t, v in counts.items()}


def fine_meta(path):
    try:
        d = json.load(open(path, encoding="utf-8"))
    except Exception:
        return "", ""
    m = d.get("_meta") or {}
    last = m.get("last", "")
    if not last:
        for k, v in d.items():
            if k != "_meta" and isinstance(v, dict):
                for t in v:
                    if t > last:
                        last = t
    return last, m.get("store", "")


def should_alert(lag, limit):
    if lag < limit:
        return False
    return ((lag - limit) % REPEAT_MIN) < WINDOW_MIN


def push(title, message):
    if not TOPIC:
        print("NTFY_TOPIC 비어 있음, 알림 못 보냄:", title, message)
        return
    body = json.dumps({"topic": TOPIC, "title": title, "message": message,
                       "priority": 5, "tags": ["warning"]}).encode("utf-8")
    req = urllib.request.Request("https://ntfy.sh/", data=body,
                                 headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=20).read()
    print("알림 보냄:", title)


def main():
    now = datetime.now(KST)
    if os.environ.get("TEST_ALERT") == "1":
        push("감시 테스트", "깃허브 감시 프로그램에서 보낸 테스트 알림이에요. 이게 보이면 이상 알림도 이렇게 와요.")
        return
    problems = []
    for name, base in SITES:
        full = newest_full(f"{base}/history.json")
        if not full:
            problems.append((f"{name} 기록 없음", f"{name} 수집 기록 파일이 비어 있어요."))
        else:
            lag = (now - to_dt(full)).total_seconds() / 60
            print(name, "전체 조회 최근", full, "지연(분)", int(lag))
            if should_alert(lag, FULL_LIMIT_MIN):
                problems.append((f"{name} 전체 조회 멈춤",
                                 f"{name} 전체 조회가 {int(lag // 60)}시간 {int(lag % 60)}분째 없어요. 최근 {full.replace('T', ' ')}. 수집 컴퓨터 꺼짐, 크롬 닫힘, 로그인 풀림을 확인해 주세요."))
        if full:
            try:
                counts = product_counts(f"{base}/history.json")
                newest = to_dt(full)
                recent = [n for t, n in counts.items() if timedelta(0) < newest - to_dt(t) <= timedelta(hours=24)]
                now_n = counts.get(full[:16], 0)
                best = max(recent) if recent else 0
                print(name, "최근 상품 수", now_n, "지난 하루 최대", best)
                lag_p = (now - newest).total_seconds() / 60
                if best and now_n < best * PARTIAL_RATIO and lag_p < 35:
                    problems.append((f"{name} 일부만 수집",
                                     f"{name} {full.replace('T', ' ')} 조회에서 상품 {now_n}개만 모였어요 (평소 {best}개). 특정 상품이 로그인을 요구하거나 크롬 탭이 막혔는지 확인해 주세요."))
            except Exception as e:
                print(name, "상품 수 점검 실패", e)
        fine, store = fine_meta(f"{base}/history_fine.json")
        if fine:
            # 새벽 0시~6시는 10분 조회를 쉬는 시간이라 6시부터 센다
            start = now.replace(hour=6, minute=0, second=0, microsecond=0)
            if now.hour < 6:
                continue
            ref = max(to_dt(fine), start)
            lag = (now - ref).total_seconds() / 60
            print(name, "10분 조회 최근", fine, "지연(분)", int(lag))
            if should_alert(lag, FINE_LIMIT_MIN):
                problems.append((f"{name} {store or ''} 10분 조회 멈춤".replace("  ", " "),
                                 f"{name} {store or ''} 10분 조회가 {int(lag)}분째 없어요. 최근 {fine.replace('T', ' ')}."))
    for t, m in problems:
        push(t, m)
    if not problems:
        print("이상 없음")


if __name__ == "__main__":
    main()
