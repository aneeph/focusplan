<?php
// CORS headers — without these the browser blocks AJAX requestscoming from a different origin than the server.
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE");
header("Content-Type: application/json");

// Path to the XML file we use as our data store
$xmlFile = "tasks.xml";

// Read the HTTP method to decide what operation to perform
$method = $_SERVER["REQUEST_METHOD"];

// ── GET: return all tasks ─────────────────────────────────────────
if ($method === "GET") {
    $tasks = loadTasks();
    echo json_encode($tasks);
}

// ── POST: create a new task ───────────────────────────────────────
elseif ($method === "POST") {
    // Data comes in the request body as JSON
    $data = json_decode(file_get_contents("php://input"), true);

    // Validate before saving 
    $errors = validateTask($data);
    if (!empty($errors)) {
        http_response_code(400);
        echo json_encode(["error" => implode(", ", $errors)]);
        exit;
    }

    $tasks   = loadTasks();
    $newTask = [
        "id"      => time(), // Unix timestamp as a simple unique ID
        "name"    => trim($data["name"]),
        "subject" => trim($data["subject"]),
        "minutes" => (int)$data["minutes"],
        "status"  => "pending" // always starts as pending
    ];
    $tasks[] = $newTask;
    saveTasks($tasks);
    echo json_encode($newTask);
}

// ── PUT: update a task's status ───────────────────────────────────
elseif ($method === "PUT") {
    $data  = json_decode(file_get_contents("php://input"), true);
    $tasks = loadTasks();

    // Find the task by ID and flip its status.
    foreach ($tasks as &$task) {
        if ($task["id"] == $data["id"]) {
            $task["status"] = $data["status"];
            break;
        }
    }

    saveTasks($tasks);
    echo json_encode(["ok" => true]);
}

// ── DELETE: remove a task ─────────────────────────────────────────
elseif ($method === "DELETE") {
    $data  = json_decode(file_get_contents("php://input"), true);
    $tasks = loadTasks();

    // array_filter keeps only tasks whose ID doesn't match.
    $tasks = array_values(array_filter($tasks, function($t) use ($data) {
        return $t["id"] != $data["id"];
    }));

    saveTasks($tasks);
    echo json_encode(["ok" => true]);
}

// ── AUXILIAR FUNCTIONS ──────────────────────────────────────────────

// Reads tasks.xml and returns all tasks as a plain PHP array.
function loadTasks() {
    global $xmlFile;
    $tasks = [];

    $xml = simplexml_load_file($xmlFile);

    foreach ($xml->task as $task) {
        $tasks[] = [
            "id"      => (int)    $task->id,
            "name"    => (string) $task->name,
            "subject" => (string) $task->subject,
            "minutes" => (int)    $task->minutes,
            "status"  => (string) $task->status
        ];
    }

    return $tasks;
}

// Saves the tasks array back to XML.
function saveTasks($tasks) {
    global $xmlFile;
    $xml = new SimpleXMLElement('<?xml version="1.0" encoding="UTF-8"?><tasks xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="tasks.xsd"></tasks>');

    foreach ($tasks as $task) {
        $node = $xml->addChild("task");
        $node->addChild("id",      $task["id"]);
        $node->addChild("name",    $task["name"]);
        $node->addChild("subject", $task["subject"]);
        $node->addChild("minutes", $task["minutes"]);
        $node->addChild("status",  $task["status"]);
    }

    // Convert to DOMDocument to save with proper indentation
    $dom = new DOMDocument("1.0", "UTF-8");
    $dom->preserveWhiteSpace = false;
    $dom->formatOutput       = true;
    $dom->loadXML($xml->asXML());
    $dom->save($xmlFile);
}

// Validates incoming task data before saving.
// Returns an array of error messages — empty means everything is fine.
function validateTask($data) {
    $errors = [];
    if (empty(trim($data["name"] ?? ""))) {
        $errors[] = "Task name is required";
    }

    if (empty(trim($data["subject"] ?? ""))) {
        $errors[] = "Subject is required";
    }

    if (!isset($data["minutes"]) || !is_numeric($data["minutes"]) || (int)$data["minutes"] < 1) {
        $errors[] = "Minutes must be a number greater than zero";
    }

    return $errors;
}
?>