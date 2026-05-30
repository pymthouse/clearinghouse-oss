FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    apache2 \
    libapache2-mod-auth-openidc \
    ca-certificates \
    gettext-base \
  && rm -rf /var/lib/apt/lists/*

RUN a2enmod headers proxy proxy_http auth_openidc rewrite ssl \
  && a2dissite 000-default.conf 2>/dev/null || true \
  && sed -i 's/^Listen 80$/Listen 8080/' /etc/apache2/ports.conf \
  && printf '\nServerName localhost\n' >> /etc/apache2/apache2.conf \
  && mkdir -p /var/cache/apache2/mod_auth_openidc \
  && chown www-data:www-data /var/cache/apache2/mod_auth_openidc

COPY httpd.conf.template /etc/apache2/sites-available/000-default.conf.template
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/docker-entrypoint.sh"]
