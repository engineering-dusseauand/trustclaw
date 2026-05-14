#!/bin/bash

echo "=== Environment Secrets Generator ==="
echo ""
echo "Add these to your .env file or Vercel environment variables:"
echo ""
echo "CRON_SECRET=$(openssl rand -base64 32)"
echo ""
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)"
echo ""
