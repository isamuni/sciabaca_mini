### Description

Sciabaca_mini is a small application which aggregates events from facebook pages and groups

This app is still under active development, so you may want to fork it.

### Warning: This does no longer work 

This does no longer work because of changes to facebook graph API, requiring manual approval to access the posts of a group or the events of a page. It's unclear if FB APIs will change again at a later time.

### Deploy

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)

Env variables:

- `FACEBOOK_APP_TOKEN` app token (not the api key) of your facebook app. Required.
- `ADMIN_PASS` password for the `config` section (defaults to `password`). User is "Admin"
- `PORT` defaults to 3000

Usage:

- `/` exposes the crawled data
- `/json` exports the data in json
- `/ical` exports the data in ical
- `/config` (password-protected) allows editing the configuration
