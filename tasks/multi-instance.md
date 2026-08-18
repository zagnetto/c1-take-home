# Run it on more than one instance

Right now everything runs as a single API instance. Before long one box won't be enough and I'll
need to run a few of them.

The proxy in front will happily spread traffic across instances — try it:

```
docker compose up -d --scale api=3
```

...but I've got a feeling the real-time side won't survive that. Make the live bits — new messages
showing up, the unread dot — keep working when the app is running as several instances.
