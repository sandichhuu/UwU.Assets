# UwU Assets

### Why ?
After few years working on game dev / web dev / backend ... position.
Sometime projects using the same asset but have to separate because have no tool support.
For example:
```
Example1: Game mobile has game items, the website using icon of items also for trading purpose.
Example2: A website separate features into multiple projects (because tech-stack / too big / ...).
And their using the same assets.
```
So I need a tool support manage the Image, Video, Audio, Localization without recompile the source code.
Replace when needs and faster workflow.

### Features
- Auto convert image to webp during upload.
- Auto convert image to smaller or bigger size.
- Auto convert video to webm.
- Auto convert audio to ogg.
- Audio/Text localization.
- Replace assets faster without rebuild the source code.
- AI auto translate localization. (Have to write the English first, then other languages auto).

### Deployment
I'm usually using this tool with docker-compose.
```yaml
services:
  uwu-assets:
    image: uwu-assets:local
    container_name: uwu-assets
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: 3000
      SQLITE_DATABASE_PATH: /app/data/database.sqlite
      ASSET_STORAGE_PATH: /app/data/assets
    volumes:
      - uwu-assets-data:/app/data
    networks:
      - proxy-net
networks:
  proxy-net:
    external: true
volumes:
  uwu-assets-data:
```

### Preview
<img width="1919" height="948" alt="image" src="https://github.com/user-attachments/assets/7ce8ed21-18a5-4fae-92f5-ef1f967235b9" />
