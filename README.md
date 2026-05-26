# focusplan
FocusPlan is a web application that combines a task manager with Pomodoro timer. You can create and organize your study or work tasks, track your progress, and use the built-in timer to work in focused sessions with automatic breaks.

# Tecnologies
PHP · XML · XSD · JSON Schema · JavaScript · jQuery · AJAX · WebSocket · HTML · CSS

# Project Structure
index.html — main page
style.css — styles
app.js — client-side logic (AJAX + WebSocket)
tasks.php — REST API for task management
websocket.php — WebSocket server for the Pomodoro timer
tasks.xml — data store
tasks.xsd — XML Schema
tasks.schema.json — JSON Schema

# How tu Run
1. Place the files in C:\xampp\htdocs\focusplan\
2. Start Apache from XAMPP
3. Run the WebSocket server: C:\xampp\php\php.exe C:\xampp\htdocs\focusplan\websocket.php
4. Open http://localhost/focusplan in your browser
