# Source this to give wrangler the hackathon account's id and token without printing them.
#   . tools/cf_env.sh && npx wrangler d1 list
eval "$(python -c "
import re
for l in open(r'C:\Users\User\.cloudflare\hackathon-cf-account.local.txt', encoding='utf-8-sig'):
    m = re.match(r'^\s*(CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_API_TOKEN)\s*=\s*(\S+)', l)
    if m: print('export %s=%s' % m.groups())
")"
