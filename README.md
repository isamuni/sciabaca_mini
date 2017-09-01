Sciabaca_mini is a small application which aggregates events from facebook pages and groups

This app is still under active development, so you may want to fork it.

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)

Env variables:

- `FACEBOOK_APP_TOKEN` app token (not the api key) of your facebook app. Required.
- `ADMIN_PASS` password for the `config` section (defaults to `password`)
- `PORT` defaults to 3000

Usage:

- `/` exposes the crawled data
- `/config` (password-protected) allows editing the configuration
