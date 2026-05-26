<?php
/*
    FocusPlan — websocket.php
    Standalone WebSocket server for the Pomodoro timer.
    Run it manually from the terminal with:
    C:\xampp\php\php.exe C:\xampp\htdocs\focusplan\websocket.php
*/

// Show all errors and disable output buffering so we can
// see echo messages in the terminal in real time
// prevent PHP from killing the script after 30 seconds
ini_set('display_errors', 1);
error_reporting(E_ALL);
ob_implicit_flush(true);
set_time_limit(0); 

$host = '127.0.0.1';
$port = 8080;

// Open a TCP socket
$server = stream_socket_server("tcp://$host:$port", $errno, $errstr);
if (!$server) die("Error: $errstr ($errno)\n");

echo "WebSocket server running at ws://$host:$port\n";

$clients = []; // holds all connected clients

// ── MAIN LOOP ─────────────────────────────────────────────────────
while (true) {
    $read = [$server];
    foreach ($clients as $c) $read[] = $c['socket'];

    $write = $except = null;
    if (stream_select($read, $write, $except, 0, 200000) === false) continue;

    // ── New connection  (Websocket Handshake) ───────────────────────
    if (in_array($server, $read)) {
        $socket  = stream_socket_accept($server);
        $request = fread($socket, 1500);

        // The browser sends a key — we hash it with a fixed magic string
        // and send it back. This confirms we understand the WS protocol.
        preg_match('/Sec-WebSocket-Key: (.+)\r\n/', $request, $matches);
        if (isset($matches[1])) {
            $key    = trim($matches[1]);
            $accept = base64_encode(
                sha1($key . '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', true)
            );
            $response = "HTTP/1.1 101 Switching Protocols\r\n"
                      . "Upgrade: websocket\r\n"
                      . "Connection: Upgrade\r\n"
                      . "Sec-WebSocket-Accept: $accept\r\n\r\n";
            fwrite($socket, $response);

            $id = uniqid();
            $clients[$id] = [
                'socket'    => $socket,
                'running'   => false,
                'seconds'   => 25 * 60,
                'isBreak'   => false,
                'workSecs'  => 25 * 60,
                'breakSecs' => 5  * 60,
                'lastTick'  => 0,
            ];
            echo "Client connected: $id\n";
        }

        unset($read[array_search($server, $read)]);
    }

    // ── Incoming messages ──────────────────────────────────────────
    foreach ($clients as $id => &$client) {
        if (!in_array($client['socket'], $read)) continue;

        $data = fread($client['socket'], 1500);
        if (!$data || strlen($data) < 2) {
            fclose($client['socket']);
            unset($clients[$id]);
            echo "Client disconnected: $id\n";
            continue;
        }

        $msg = decodeFrame($data); //Unwraps the wbsocket frame and gives JSON
        if (!$msg) continue;

        $payload = json_decode($msg, true);
        if (!$payload) continue;

        $action = $payload['action'] ?? '';

        if ($action === 'start') {
            // Store the configured durations and start ticking
            $client['workSecs']  = ($payload['workMin']  ?? 25) * 60;
            $client['breakSecs'] = ($payload['breakMin'] ?? 5)  * 60;
            $client['seconds']   = $client['workSecs'];
            $client['isBreak']   = false;
            $client['running']   = true;
            $client['lastTick']  = time();
            echo "Timer started for $id\n";

        } elseif ($action === 'pause') {
            $client['running'] = false;
            echo "Timer paused for $id\n";

        } elseif ($action === 'reset') {
            // Stop the timer and send one tick so the display resets
            $client['running'] = false;
            $client['seconds'] = $client['workSecs'];
            $client['isBreak'] = false;
            sendMsg($client['socket'], [
                'type'    => 'tick',
                'seconds' => $client['seconds'],
                'isBreak' => false
            ]);
        }
    }
    unset($client);

    // ── Timer tick ────────────────────────────────────────────────
    $now = time();
    foreach ($clients as $id => &$client) {
        if (!$client['running'])         continue;
        if ($now <= $client['lastTick']) continue;

        $client['lastTick'] = $now;
        $client['seconds']--;

        if ($client['seconds'] <= 0) {
            if (!$client['isBreak']) {
                // Work session ended — switch to break
                $client['isBreak'] = true;
                $client['seconds'] = $client['breakSecs'];
                sendMsg($client['socket'], ['type' => 'finished', 'mode' => 'work']);
            } else {
                // Break ended — switch back to work
                $client['isBreak'] = false;
                $client['seconds'] = $client['workSecs'];
                sendMsg($client['socket'], ['type' => 'finished', 'mode' => 'break']);
            }
        } else {
            sendMsg($client['socket'], [
                'type'    => 'tick',
                'seconds' => $client['seconds'],
                'isBreak' => $client['isBreak'],
            ]);
        }
    }
    unset($client);
}

// ── AUXILIAR FUNCTIONS ──────────────────────────────────────────────

// Decodes a WebSocket frame and returns the raw payload string.
function decodeFrame($data) {
    if (strlen($data) < 2) return false;
    $masked  = (ord($data[1]) >> 7) & 0x1;
    $length  =  ord($data[1]) & 0x7F;
    $offset  = 2;
    if ($length === 126) $offset = 4;
    if ($length === 127) $offset = 10;
    if (!$masked) return substr($data, $offset);
    $mask    = substr($data, $offset, 4);
    $payload = substr($data, $offset + 4);
    $decoded = '';
    for ($i = 0; $i < strlen($payload); $i++) {
        $decoded .= $payload[$i] ^ $mask[$i % 4];
    }
    return $decoded;
}

// Encodes a PHP array as a WebSocket frame and writes it to the socket.
function sendMsg($socket, $data) {
    $json   = json_encode($data);
    $length = strlen($json);
    $frame  = chr(0x81);
    if ($length <= 125) {
        $frame .= chr($length);
    } elseif ($length <= 65535) {
        $frame .= chr(126) . pack('n', $length);
    } else {
        $frame .= chr(127) . pack('J', $length);
    }
    $frame .= $json;
    @fwrite($socket, $frame);
}
?>