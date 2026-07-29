###Панель для формирования подписок из vless ключей или json конфигов

1. В .env файле прописать токен админа
2. Получить через letsencrypt сертификаты для домена и положить их в папку certs
3. Склонировать на VPS репозиторий
4. Веб панель будет доступна по адресу https://domain-addr/admin-ui
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