# TopoR Balancer Reverse Proxy Protection

Admin API already requires:

```http
Authorization: Bearer <TOPOR_BALANCER_ADMIN_TOKEN>
```

Reverse proxy protection is still recommended for:

- `/admin/topor-balancer`
- `/api/topor-balancer`

Use one or more of:

- Basic Auth;
- IP allowlist;
- VPN/private network access;
- Cloudflare Zero Trust or another identity-aware proxy.

## Caddy Example

This example protects Admin UI and Admin API with Basic Auth and proxies normal subscription traffic to the app.

Generate a Caddy password hash:

```bash
caddy hash-password --plaintext 'replace-with-admin-password'
```

Caddyfile:

```caddyfile
subscription.example.com {
    encode zstd gzip

    @topor_admin path /admin/topor-balancer /api/topor-balancer*
    basicauth @topor_admin {
        admin $2a$14$replace_with_caddy_hash
    }

    reverse_proxy remnawave-subscription-page-with-balancer:3010
}
```

IP allowlist variant:

```caddyfile
subscription.example.com {
    encode zstd gzip

    @topor_admin path /admin/topor-balancer /api/topor-balancer*
    @not_allowed {
        path /admin/topor-balancer /api/topor-balancer*
        not remote_ip 203.0.113.10 198.51.100.0/24
    }
    respond @not_allowed 403

    reverse_proxy remnawave-subscription-page-with-balancer:3010
}
```

## Nginx Example

Create a Basic Auth file:

```bash
htpasswd -c /etc/nginx/.htpasswd-topor admin
```

Nginx server block:

```nginx
server {
    listen 443 ssl http2;
    server_name subscription.example.com;

    ssl_certificate /etc/letsencrypt/live/subscription.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/subscription.example.com/privkey.pem;

    location = /admin/topor-balancer {
        auth_basic "TopoR Balancer Admin";
        auth_basic_user_file /etc/nginx/.htpasswd-topor;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://remnawave-subscription-page-with-balancer:3010;
    }

    location ^~ /api/topor-balancer {
        auth_basic "TopoR Balancer Admin";
        auth_basic_user_file /etc/nginx/.htpasswd-topor;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://remnawave-subscription-page-with-balancer:3010;
    }

    location / {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://remnawave-subscription-page-with-balancer:3010;
    }
}
```

IP allowlist variant:

```nginx
location ^~ /api/topor-balancer {
    allow 203.0.113.10;
    allow 198.51.100.0/24;
    deny all;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://remnawave-subscription-page-with-balancer:3010;
}
```

Repeat the same allow/deny block for `/admin/topor-balancer`.

## Notes

- Keep `TOPOR_BALANCER_ADMIN_TOKEN` enabled even when reverse proxy auth is used.
- Do not expose `TOPOR_BALANCER_ADMIN_TOKEN` in proxy logs.
- Prefer HTTPS only.
- Consider adding rate limits on `/api/topor-balancer`.
