#!/usr/bin/env python3
"""
Cloud Nine 一键部署脚本
自动创建 Cloudflare 资源、构建部署 Worker + Pages、配置密钥和环境变量。
运行后即可直接使用。
"""

import subprocess, sys, os, json, secrets, base64, string, time, urllib.request, urllib.error

# ── helpers ────────────────────────────────────────────

def green(s):  return f"\033[92m{s}\033[0m"
def yellow(s): return f"\033[93m{s}\033[0m"
def red(s):    return f"\033[91m{s}\033[0m"
def bold(s):   return f"\033[1m{s}\033[0m"

def ask(prompt, default=None, required=True, secret=False):
    """交互式提问"""
    d = f" [{default}]" if default else ""
    if secret:
        try:
            import msvcrt
            while True:
                print(f"{prompt}{d}: ", end="", flush=True)
                val = ""
                while True:
                    ch = msvcrt.getch()
                    if ch in (b'\r', b'\n'):
                        print()
                        break
                    elif ch == b'\x08':
                        if val:
                            val = val[:-1]
                            print("\b \b", end="", flush=True)
                    elif ch == b'\x03':
                        raise KeyboardInterrupt
                    else:
                        val += ch.decode("utf-8", errors="ignore")
                        print("*", end="", flush=True)
                if val:
                    return val
                if default:
                    return default
                if not required:
                    return ""
                print(red("此项为必填"))
        except ImportError:
            import getpass
            while True:
                val = getpass.getpass(f"{prompt}{d}: ").strip()
                if val:
                    return val
                if default:
                    return default
                if not required:
                    return ""
                print(red("此项为必填"))
    else:
        while True:
            val = input(f"{prompt}{d}: ").strip()
            if val:
                return val
            if default:
                return default
            if not required:
                return ""
            print(red("此项为必填"))

def cf_req(method, path, body=None):
    """Cloudflare REST API 请求"""
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    url = f"https://api.cloudflare.com/client/v4{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            if not result.get("success"):
                errors = result.get("errors", [])
                msg = "; ".join(e.get("message", str(e)) for e in errors)
                raise Exception(f"API 错误: {msg}")
            return result.get("result")
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="ignore")
        raise Exception(f"HTTP {e.code}: {body}")

def run_live(cmd, cwd=None, env=None):
    """运行命令，实时输出"""
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    proc = subprocess.Popen(cmd, shell=True, cwd=cwd, env=merged_env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace")
    out = []
    for line in proc.stdout:
        print(f"    {line.rstrip()}")
        out.append(line)
    proc.wait()
    if proc.returncode != 0:
        raise Exception(f"命令失败 (exit {proc.returncode}): {cmd}")
    return "".join(out)

def run_silent(cmd, cwd=None, env=None, stdin=None):
    """运行命令，静默捕获输出"""
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    r = subprocess.run(cmd, shell=True, cwd=cwd, env=merged_env,
                       capture_output=True, text=True, input=stdin,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print(red(f"  ✗ {cmd}"))
        if r.stderr:
            print(red(f"    {r.stderr.strip()}"))
        raise Exception(f"命令失败: {cmd}")
    return r.stdout.strip()

def project_root():
    return os.path.dirname(os.path.abspath(__file__))

# ── 主流程 ────────────────────────────────────────────

def main():
    print()
    print(bold("=" * 55))
    print(bold("  Cloud Nine — 一键部署脚本"))
    print(bold("=" * 55))
    print()
    print("本脚本将自动完成以下操作：")
    print("  1. 创建 KV 命名空间 + D1 数据库 + 执行迁移")
    print("  2. 构建并部署 Cloudflare Worker")
    print("  3. 构建并部署 Cloudflare Pages")
    print("  4. 配置密钥、环境变量、绑定")
    print("  5. (可选) 配置自定义域名和路由")
    print()
    print("前提条件：")
    print("  - 已安装 Node.js >= 18（脚本会自动检测）")
    print()

    root = project_root()
    worker_dir = os.path.join(root, "worker")
    frontend_dir = os.path.join(root, "frontend")

    # ─── Step 0: 依赖检测 ───

    print(bold("── 第零步：检测依赖 ──"))
    print()

    # 检测 Node.js
    try:
        run_silent("node --version")
        print(green("  ✓ Node.js 已安装"))
    except:
        print(red("  ✗ 未检测到 Node.js，请先安装 Node.js >= 18: https://nodejs.org"))
        input("按 Enter 退出...")
        sys.exit(1)

    # 检测 worker/node_modules
    if os.path.exists(os.path.join(worker_dir, "node_modules")):
        print("  ✓ worker 依赖已安装")
    else:
        print("  ⟳ 安装 worker 依赖...")
        run_live("npm install", cwd=worker_dir)
        print(green("  ✓ worker 依赖安装完成"))

    # 检测 frontend/node_modules
    if os.path.exists(os.path.join(frontend_dir, "node_modules")):
        print("  ✓ frontend 依赖已安装")
    else:
        print("  ⟳ 安装 frontend 依赖...")
        run_live("npm install", cwd=frontend_dir)
        print(green("  ✓ frontend 依赖安装完成"))

    print()

    # ─── Step 1: 收集信息 ───

    print(bold("── 第一步：收集配置信息 ──"))
    print()

    api_token = ask("Cloudflare API Token", secret=True)
    os.environ["CLOUDFLARE_API_TOKEN"] = api_token

    print("  验证 Token...")
    verify = cf_req("GET", "/user/tokens/verify")
    account_id = None
    accounts = cf_req("GET", "/accounts?page=1&per_page=1")
    if isinstance(accounts, list) and accounts:
        account_id = accounts[0]["id"]
        acc_name = accounts[0].get("name", "")
        print(green(f"  ✓ 账户: {acc_name} ({account_id})"))
    if not account_id:
        print(red("  ✗ 无法获取账户 ID，请检查 API Token 权限"))
        input("按 Enter 退出...")
        sys.exit(1)

    tg_token = ask("Telegram Bot Token", secret=True)
    tg_chat_id = ask("Telegram 群组 Chat ID（如 -100xxxxxxxxxx）")

    worker_name = ask("Worker 项目名称", default="tgdrive")
    pages_name = ask("Pages 项目名称", default="tgdrive-pages")
    custom_domain = ask("自定义域名（可选，如 drive.example.com）", required=False)
    if not custom_domain:
        print("  将使用默认 workers.dev 域名")
    print()

    # ─── Step 2: 生成密钥 ───

    print(bold("── 第二步：生成密钥 ──"))
    jwt_secret = base64.b64encode(secrets.token_bytes(64)).decode()
    jwt_refresh = base64.b64encode(secrets.token_bytes(64)).decode()
    admin_pw = ''.join(secrets.choice(string.ascii_letters + string.digits + "!@#$%^&*") for _ in range(12))
    webhook_secret = base64.b64encode(secrets.token_bytes(32)).decode()
    print(f"  JWT_SECRET:        {jwt_secret[:24]}...")
    print(f"  JWT_REFRESH_SECRET:{jwt_refresh[:24]}...")
    print(f"  ADMIN_PASSWORD:    {admin_pw}")
    print(f"  WEBHOOK_SECRET:    {webhook_secret[:24]}...")
    print()

    # ─── Step 3: 创建 KV 和 D1 ───

    print(bold("── 第三步：创建 Cloudflare 资源 ──"))

    print("  检查/创建 KV 命名空间...")
    kv_id = None
    try:
        kv = cf_req("POST", f"/accounts/{account_id}/storage/kv/namespaces",
                    {"title": f"{worker_name}-kv"})
        kv_id = kv["id"]
        print(green(f"  ✓ KV 已创建: {kv_id}"))
    except Exception as e:
        if "already exists" in str(e) or "10014" in str(e):
            print("  KV 命名空间已存在，查找中...")
            existing = cf_req("GET", f"/accounts/{account_id}/storage/kv/namespaces?per_page=100")
            for ns in (existing or []):
                if ns.get("title") == f"{worker_name}-kv":
                    kv_id = ns["id"]
                    print(green(f"  ✓ KV 已存在: {kv_id}"))
                    break
        if not kv_id:
            raise

    print("  检查/创建 D1 数据库...")
    d1_id = None
    try:
        d1 = cf_req("POST", f"/accounts/{account_id}/d1/database",
                    {"name": f"{worker_name}-db"})
        d1_id = d1["uuid"]
        print(green(f"  ✓ D1 已创建: {d1_id}"))
    except Exception as e:
        if "already exists" in str(e):
            print("  D1 数据库已存在，查找中...")
            existing = cf_req("GET", f"/accounts/{account_id}/d1/database?per_page=100")
            for db in (existing or []):
                if db.get("name") == f"{worker_name}-db":
                    d1_id = db["uuid"]
                    print(green(f"  ✓ D1 已存在: {d1_id}"))
                    break
        if not d1_id:
            raise

    print("  执行数据库迁移（跳过已存在的表）...")
    for migration in ["0001_init.sql", "0002_admin_index.sql"]:
        mpath = os.path.join(worker_dir, "migrations", migration)
        with open(mpath, "r", encoding="utf-8") as f:
            sql = f.read()
        statements = [s.strip() for s in sql.split(";")
                      if s.strip() and not s.strip().startswith("--")]
        for stmt in statements:
            try:
                cf_req("POST", f"/accounts/{account_id}/d1/database/{d1_id}/query",
                       {"sql": stmt + ";"})
            except Exception as e:
                if "already exists" in str(e):
                    pass  # 表/索引已存在，跳过
                else:
                    raise
    print(green("  ✓ 迁移完成"))

    # ─── Step 4: Worker ───

    print()
    print(bold("── 第四步：构建并部署 Worker ──"))

    # 写入 wrangler.jsonc
    wrangler_config = {
        "name": worker_name,
        "main": "dist/worker.js",
        "compatibility_date": "2025-07-01",
        "account_id": account_id,
        "observability": {
            "enabled": False,
            "head_sampling_rate": 1,
            "logs": {
                "enabled": True,
                "head_sampling_rate": 1,
                "persist": True,
                "invocation_logs": True
            }
        },
        "kv_namespaces": [
            {"binding": "METADATA_KV", "id": kv_id}
        ],
        "d1_databases": [
            {"binding": "DB", "database_name": f"{worker_name}-db", "database_id": d1_id}
        ]
    }
    wpath = os.path.join(worker_dir, "wrangler.jsonc")
    with open(wpath, "w", encoding="utf-8") as f:
        json.dump(wrangler_config, f, indent=2)
    print(f"  ✓ 已写入 worker/wrangler.jsonc")

    print("  构建 Worker...")
    run_live("npx esbuild src/index.ts --bundle --format=esm --target=es2022 --outfile=dist/worker.js --platform=browser --external:cloudflare:workers",
             cwd=worker_dir)
    print(green("  ✓ Worker 构建完成"))

    print("  部署 Worker...")
    run_live("npx wrangler deploy", cwd=worker_dir)
    print(green("  ✓ Worker 部署完成"))

    print("  设置 Worker Secrets...")
    worker_secrets = {
        "TELEGRAM_BOT_TOKEN": tg_token,
        "TELEGRAM_CHANNEL_ID": tg_chat_id,
        "JWT_SECRET": jwt_secret,
        "JWT_REFRESH_SECRET": jwt_refresh,
        "ADMIN_PASSWORD": admin_pw,
        "WEBHOOK_SECRET": webhook_secret,
    }
    env_extra = {"CLOUDFLARE_API_TOKEN": api_token}
    for name, value in worker_secrets.items():
        run_silent(f"npx wrangler secret put {name}", cwd=worker_dir, env=env_extra, stdin=value + "\n")
        print(f"    ✓ {name}")
    print(green("  ✓ Secrets 设置完成"))

    # ─── Step 5: Pages ───

    print()
    print(bold("── 第五步：构建并部署 Pages ──"))

    # 确定 API 地址
    if custom_domain:
        api_base = f"https://{custom_domain}/api"
    else:
        workers_dev = ""
        try:
            sd = cf_req("GET", f"/accounts/{account_id}/workers/subdomain")
            workers_dev = sd.get("name", "")
        except:
            pass
        if workers_dev:
            api_base = f"https://{worker_name}.{workers_dev}.workers.dev/api"
        else:
            api_base = f"https://{worker_name}.workers.dev/api"
    print(f"  API Base = {api_base}")

    print("  构建 Frontend...")
    run_live("npm run build", cwd=frontend_dir)
    print(green("  ✓ Frontend 构建完成"))

    # 将 API 地址注入到 index.html（替代运行时注释占位符）
    dist_index = os.path.join(frontend_dir, "dist", "index.html")
    with open(dist_index, "r", encoding="utf-8") as f:
        html = f.read()
    config_script = f'<script>window.__TCD_API_BASE__ = "{api_base}";</script>'
    # 替换注释占位符（保持向后兼容：如果已有未注释的脚本则替换内容）
    html = html.replace(
        '<!-- <script>window.__TCD_API_BASE__ = "https://your-domain.com/api";</script> -->',
        config_script
    )
    with open(dist_index, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"  ✓ 已注入 API 地址到 dist/index.html")

    print("  创建并部署 Pages...")
    run_silent(f"npx wrangler pages project create {pages_name} --production-branch=main",
               cwd=frontend_dir, env=env_extra)
    run_live(f"npx wrangler pages deploy dist --project-name={pages_name}",
             cwd=frontend_dir, env=env_extra)
    print(green("  ✓ Pages 部署完成"))

    pages_url = f"https://{pages_name}.pages.dev"

    # ─── Step 6: 自定义域名 ───

    if custom_domain:
        print()
        print(bold("── 第六步：配置自定义域名 ──"))
        try:
            cf_req("POST", f"/accounts/{account_id}/pages/projects/{pages_name}/domains",
                   {"domain": custom_domain})
            print(green(f"  ✓ Pages 绑定域名: {custom_domain}"))
        except Exception as e:
            print(yellow(f"  ⚠ Pages 域名绑定失败: {e}"))

        try:
            parts = custom_domain.split(".")
            zone_name = ".".join(parts[-2:]) if len(parts) >= 2 else custom_domain
            # 获取 zone ID
            zones = cf_req("GET", f"/zones?name={zone_name}")
            if isinstance(zones, list) and zones:
                zone_id = zones[0]["id"]
                cf_req("POST", f"/zones/{zone_id}/workers/routes",
                       {"pattern": f"{custom_domain}/api/*", "script": worker_name})
                print(green(f"  ✓ Worker Route: {custom_domain}/api/*"))
            else:
                print(yellow(f"  ⚠ 未找到域名 {zone_name} 的 Zone，跳过路由配置"))
        except Exception as e:
            print(yellow(f"  ⚠ Worker Route 配置失败: {e}"))

    # ─── 完成 ───

    print()
    print(bold("=" * 55))
    print(bold("  部署完成！"))
    print(bold("=" * 55))
    print()
    if custom_domain:
        print(f"  站点地址:   https://{custom_domain}")
    else:
        print(f"  站点地址:   {pages_url}")
    print(f"  API 地址:   {api_base}")
    print()
    print(f"  管理后台密码: {bold(admin_pw)}")
    print(f"  首次部署后访问 {api_base.rstrip('/api')}/api/admin/login")
    print(f"  用以上密码登录，然后访问 /api/admin/migrate 完成数据回填。")
    print()
    print(f"  JWT_SECRET:         {jwt_secret}")
    print(f"  JWT_REFRESH_SECRET: {jwt_refresh}")
    print(f"  WEBHOOK_SECRET:     {webhook_secret}")
    print()
    print(yellow("  ⚠ 以上密钥已自动配置到 Worker，请妥善保存！"))
    print()

    # 保存密钥文件
    sf_path = os.path.join(root, "deploy-secrets.txt")
    with open(sf_path, "w", encoding="utf-8") as f:
        f.write(f"Cloud Nine 部署密钥 — {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write("=" * 40 + "\n\n")
        f.write(f"ADMIN_PASSWORD:     {admin_pw}\n")
        f.write(f"JWT_SECRET:         {jwt_secret}\n")
        f.write(f"JWT_REFRESH_SECRET: {jwt_refresh}\n")
        f.write(f"WEBHOOK_SECRET:     {webhook_secret}\n")
        f.write(f"\nCloudflare 资源:\n")
        f.write(f"KV Namespace ID:    {kv_id}\n")
        f.write(f"D1 Database ID:     {d1_id}\n")
        f.write(f"Worker Name:        {worker_name}\n")
        f.write(f"Pages Name:         {pages_name}\n")
        if custom_domain:
            f.write(f"Domain:             {custom_domain}\n")
        f.write(f"API Base:           {api_base}\n")
    print(f"  📄 密钥已保存至 deploy-secrets.txt（请勿提交到 Git！）")
    print()
    input("按 Enter 退出...")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n已取消。")
        input("按 Enter 退出...")
        sys.exit(0)
    except Exception as e:
        print(red(f"\n✗ 错误: {e}"))
        input("按 Enter 退出...")
        sys.exit(1)
