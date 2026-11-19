#!/usr/bin/env bash
# Copia de la base de datos de producción. Se corre desde tu computadora (necesita pg_dump instalado).
#
# Uso:  DATABASE_PUBLIC_URL="postgresql://..." ./scripts/respaldo.sh [carpeta]
#
# DATABASE_PUBLIC_URL es la URL pública de Postgres en Railway (pestaña Variables del servicio Postgres).
# La URL interna (postgres.railway.internal) no sirve desde afuera.
# La copia tiene datos personales de los compradores: guardala fuera del repositorio y de GitHub.
set -euo pipefail

: "${DATABASE_PUBLIC_URL:?Falta DATABASE_PUBLIC_URL (URL pública de Postgres en Railway)}"
destino="${1:-$HOME/respaldos-sorteos}"
mkdir -p "$destino"
archivo="$destino/respaldo-$(date +%F-%H%M).dump"

pg_dump "$DATABASE_PUBLIC_URL" --format=custom --no-owner --file="$archivo"
chmod 600 "$archivo"
echo "Copia guardada en: $archivo ($(du -h "$archivo" | cut -f1))"
