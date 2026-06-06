# Hosting the server on Oracle Cloud (Always Free)

This puts your Python server on a free, always-on machine in the cloud, with a
real `https://` web address your app can call from anywhere.

You only need to do this once. Budget ~30–45 minutes the first time.
Don't rush it — I'll walk you through each step in chat. This file is the map.

---

## Part 1 — Create the Oracle account (one time)

1. Go to **https://www.oracle.com/cloud/free/** and click **Start for free**.
2. Sign up: email, then a phone number, then a credit/debit card for identity
   verification. **Always Free resources never charge the card** — it's only to
   prove you're a real person. (You can pick "Always Free" only and you won't be billed.)
3. Choose a **Home Region** close to you. ⚠️ You cannot change this later, and
   your free machine must live here. Pick the nearest region.
4. Finish signup and land on the **Oracle Cloud Console** (the dashboard).

---

## Part 2 — Create the free server (a small Linux computer)

1. In the Console, open the menu (☰) → **Compute** → **Instances** → **Create instance**.
2. **Name:** `bill-reminder`.
3. **Image and shape** → **Edit**:
   - **Image:** Canonical **Ubuntu** (22.04 or 24.04).
   - **Shape:** click **Change shape** → **Ampere** → **VM.Standard.A1.Flex**
     (this is the big free ARM one). Set **1 OCPU** and **6 GB memory** — well
     within the Always Free limit. *(If A1 capacity is full in your region, use
     **VM.Standard.E2.1.Micro** instead — also Always Free.)*
4. **Networking:** leave the defaults (it creates a virtual network for you).
   Make sure **"Assign a public IPv4 address"** is **Yes**.
5. **SSH keys:** choose **Generate a key pair for me** → **Download private key**
   (and public key). Save the private key file somewhere safe, e.g.
   `~/oracle/bill-reminder.key`. **You need this to log in.**
6. Click **Create**. Wait ~1 minute until the instance is **Running**.
7. Copy the **Public IP address** shown on the instance page. Call it `SERVER_IP`.

---

## Part 3 — Open the network ports

Two separate firewalls block traffic by default. Open both for ports **80** and **443**.

### 3a. Oracle's firewall (Security List)
1. On the instance page, under **Primary VNIC**, click the **Subnet** link.
2. Click the **Security List** (e.g. "Default Security List...").
3. **Add Ingress Rules** → add two rules:
   - Source CIDR `0.0.0.0/0`, IP Protocol **TCP**, Destination port **80**
   - Source CIDR `0.0.0.0/0`, IP Protocol **TCP**, Destination port **443**

### 3b. Ubuntu's own firewall (do this after you log in, Part 4)
Oracle's Ubuntu images also block ports internally. After SSH-ing in, run:
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

---

## Part 4 — Log in and set up the server

From your Mac terminal (replace with your key path and IP):

```bash
chmod 600 ~/oracle/bill-reminder.key
ssh -i ~/oracle/bill-reminder.key ubuntu@SERVER_IP
```

Once you're in (prompt shows `ubuntu@bill-reminder`):

```bash
# 1. System packages
sudo apt update && sudo apt install -y python3-venv python3-pip git

# 2. Get your server code onto the machine.
#    Easiest: we'll push this project to GitHub, then:
#    git clone YOUR_REPO_URL ReminderApp && cd ReminderApp/server
#    (Or use scp to copy the server/ folder up — I'll help with whichever you prefer.)

# 3. Install and configure
cd ~/ReminderApp/server
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
nano .env            # paste your real ANTHROPIC_API_KEY, then Ctrl-O, Enter, Ctrl-X
```

Quick test (still over SSH):
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 &
curl http://localhost:8000/health
```
If that returns `{"status":"ok",...}`, the server runs. Stop it with `kill %1`.

---

## Part 5 — Keep it running + add HTTPS

We'll use **Caddy** — it keeps the server running and gives **automatic free HTTPS**.
This needs a domain name pointing at `SERVER_IP` (a cheap `.com` ~$10/yr, or a free
subdomain from a service like DuckDNS). Once the domain (say `bills.example.com`)
points to your IP:

```bash
# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Then run the app as a background service and let Caddy front it. **I'll give you
the exact `systemd` + `Caddyfile` config when we reach this step** — it depends on
your domain name.

End result: your app calls **`https://bills.example.com/scan`** and it just works,
24/7, for free.

---

> 🟢 **You don't have to do Part 5 to start.** For first tests we run the server on
> your Mac and the phone talks to it over Wi-Fi. Oracle is for when you want it
> always-on. Tell me when you're ready and we'll do it together, step by step.
