**Панель для формирования подписок из vless ключей или json конфигов**

1. В корне создать .env файл с переменными окружения:
```sh
HWID_ENFORCE=true
HWID_HEADER_NAME=x-hwid
ADMIN_UI_PATH=</path_to_admin_panel> //Путь к веб панели (например /admin-panel)
MAX_CLIENT_XRAY_RULES=<paste_max_client_xray_rules_here> //Максимальное количество правил xray для одного клиента (20 по умолчанию)
SOURCE_SUB_FETCH_TIMEOUT_MS=4000
```
2. Получить через letsencrypt сертификаты для домена и положить их в папку certs
3. Склонировать на VPS репозиторий
4. Веб панель будет доступна по адресу https://domain-addr/ADMIN_UI_PATH
5. Установить basic auth для nginx:
```sh
sudo apt-get update
sudo apt-get install -y apache2-utils
htpasswd -c ./nginx/.htpasswd admin
```
Вводится пароль и впоследствии делается вход в веб морду по логину admin и паролю

При любом изменении и повторном развертывании вводится сначала
`docker compose down`
после поднять
`docker compose up -d --build`