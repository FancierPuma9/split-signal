# Deploying Split Signal

One server runs everything: the game server (which also serves the built client) and Caddy in front
of it for HTTPS. HTTPS isn't optional: browsers only let a page use the microphone over a secure
connection. These steps use AWS EC2, but any Linux box with Docker works the same way.

## What you need

- A server with a public IP. An EC2 `t3.small` (2 GB) running Ubuntu 24.04 is plenty; rooms and
  matches live in memory, and voice goes browser to browser, not through the server.
- A domain or subdomain you can point at it, e.g. `splitsignal.example.com`. Caddy needs a real
  hostname to get a certificate. (No domain? `<your-ip-with-dashes>.sslip.io`, e.g.
  `203-0-113-10.sslip.io`, resolves to your IP and works too.)

## 1. Launch the instance

In the EC2 console:

1. Launch an Ubuntu 24.04 instance with your SSH key.
2. Give it an **Elastic IP** so the address survives restarts.
3. In its security group, allow inbound:
   - TCP 22 from your own IP (SSH)
   - TCP 80 and 443 from anywhere (HTTP and HTTPS; Caddy needs 80 for certificates)
   - UDP 443 from anywhere (HTTP/3, optional)
   - Only if you run the TURN relay (step 6): TCP and UDP 3478, and UDP 49160-49200
4. Point your domain's DNS **A record** at the Elastic IP.

## 2. Install Docker

SSH in, then:

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
```

Log out and back in so the `docker` group applies.

## 3. Get the code and configure it

```sh
git clone https://github.com/<you>/split-signal.git
cd split-signal
cp .env.example .env
nano .env
```

Set at least `DOMAIN` and `ACME_EMAIL`. `.env.example` explains every setting.

## 4. Start it

```sh
docker compose up -d --build
```

The first build takes a few minutes. Then open `https://<DOMAIN>`: Caddy fetches the certificate on
the first request. `docker compose logs -f` shows what's happening; `curl https://<DOMAIN>/healthz`
should answer `ok`.

## 5. Google sign-in (optional)

Sign-in only adds stats; everything else works without it.

1. In the Google Cloud console, open your OAuth client (Google Auth Platform → Clients) and add
   `https://<DOMAIN>` to **Authorized JavaScript origins**.
2. Put the client ID in `.env` as `SPLIT_SIGNAL_GOOGLE_CLIENT_ID`.
3. While the app's audience is **Testing**, only the test users you list can sign in. When you're
   ready for everyone, choose **Publish app** under Audience. Sign-in only asks for basic profile
   information, which doesn't need Google's verification.
4. `docker compose up -d` to apply.

Stats are kept in a SQLite file on the `app-data` volume.

## 6. TURN relay (optional)

Voice connects browsers directly. That works on most home networks, but some (strict corporate
networks, some mobile carriers) block it, and those players won't hear each other. A TURN server
relays audio for them:

1. Open the TURN ports in the security group (step 1).
2. In `.env`, set `TURN_EXTERNAL_IP` to `<Elastic IP>/<private IP>` (find the private IP with
   `hostname -I`), pick a `TURN_PASSWORD`, and set `SPLIT_SIGNAL_ICE_SERVERS` as in the example in
   `.env.example`, with your domain and password.
3. `docker compose --profile turn up -d`

The TURN credentials are handed to every player's browser, so treat them as shared, not secret.

## Updating

```sh
git pull
docker compose up -d --build
```

Players in a match when the server restarts lose that match (rooms live in memory); stats are safe.

## Backups

The stats database is a SQLite file (plus its `-wal` and `-shm` companions) on the `app-data`
volume. To copy them off the server together:

```sh
docker compose cp app:/data ./split-signal-backup
```
