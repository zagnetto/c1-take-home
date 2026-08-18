SET NAMES utf8mb4;

CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(190) NOT NULL
);

CREATE TABLE conversations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(200) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE conversation_participants (
  conversation_id INT NOT NULL,
  user_id INT NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE messages (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  conversation_id INT NOT NULL,
  sender_id INT NOT NULL,
  client_id VARCHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users (id, name, email) VALUES
  (1, 'Alice', 'alice@example.com'),
  (2, 'Bob', 'bob@example.com'),
  (3, 'Carol', 'carol@example.com');

INSERT INTO conversations (id, title) VALUES
  (1, 'Support — order #1042'),
  (2, 'Design sync');

INSERT INTO conversation_participants (conversation_id, user_id) VALUES
  (1, 1), (1, 2), (2, 1), (2, 3);

INSERT INTO messages (id, conversation_id, sender_id, client_id) VALUES
  (1, 1, 2, NULL),
  (2, 1, 1, NULL),
  (3, 2, 3, NULL);
