-- Embeddings cache frozen catalog content, including projections of immutable
-- chapter publications. They are not knowledge heads and grant no visibility.
CREATE TABLE retrieval_embeddings (
 digest text NOT NULL CHECK(length(digest)=64),
 model text NOT NULL,
 dimensions integer NOT NULL CHECK(dimensions BETWEEN 1 AND 4096),
 embedding vector NOT NULL,
 CHECK(vector_dims(embedding)=dimensions),
 PRIMARY KEY(digest,model)
);
INSERT INTO retrieval_embeddings SELECT * FROM memory_embeddings;
