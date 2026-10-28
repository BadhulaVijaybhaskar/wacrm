#!/bin/sh
# Harness-only transform: the box cluster has no pgvector, so map the real
# vector types back to the float4[] stand-in used by m_030/m_032 in the ref.
sed -e '/@@VECTOR_EXT@@/d' \
    -e 's/::extensions\.vector(1536)/::float4[]/g' -e 's/extensions\.vector(1536)/real[]/g' \
    -e 's/USING hnsw (embedding extensions\.vector_cosine_ops)/USING btree (id)/' "$1"
