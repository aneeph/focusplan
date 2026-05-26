$(document).ready(function () {

    // ── STATE VARIABLES ───────────────────────────────────────────────
    let allTasks       = [];     // all tasks loaded from the server
    let currentFilter  = 'all'; // which filter button is active
    let timerInterval  = null;  // reference to the local setInterval fallback
    let isRunning      = false; // whether the timer is currently ticking
    let isBreak        = false; // true during break sessions, false during work
    let secondsLeft    = 0;     // seconds remaining in the current session
    let totalWorkSecs  = 0;     // total seconds worked this session
    let totalBreakSecs = 0;     // total seconds rested this session

    // ── INIT ──────────────────────────────────────────────────────────
    // These three run immediately when the page loads.
    // The notification div is injected here rather than hardcoded in HTML
    // so it only exists when JavaScript is available.
    showDate();
    initTimer();
    loadTasks();
    $('main').prepend('<div id="notif" class="hidden"></div>');


    // ── DATE ──────────────────────────────────────────────────────────

    function showDate() {
        const now     = new Date();
        const options = { weekday: 'long', year: 'numeric',
                          month: 'long',   day: 'numeric' };
        $('#current-date').text(now.toLocaleDateString('en-GB', options));
    }


    // ── NOTIFICATION ──────────────────────────────────────────────────────────

    // Shows a message for 3 seconds then fades out,
    // type is either 'success' or 'error'
    function showNotif(msg, type) {
        $('#notif')
            .removeClass('hidden success error')
            .addClass(type)
            .html(msg)
            .delay(3000)
            .fadeOut(400, function () {
                $(this).addClass('hidden').show();
            });
    }


    // ── TASKS - AJAX ──────────────────────────────────────────────────────────

    // GET — loads all tasks when the page opens.
    // fires automatically without user input.
    function loadTasks() {
        $.ajax({
            url:     'tasks.php',
            method:  'GET',
            success: function (data) {
                allTasks = data;
                renderTasks();
                updateStats();
            }
        });
    }

    // POST — sends a new task to the server when the form is submitted.
    // e.preventDefault() stops the browser from reloading the page.
    $('#task-form').on('submit', function (e) {
        e.preventDefault();

        const newTask = {
            name:    $('#task-name').val().trim(),
            subject: $('#task-subject').val().trim(),
            minutes: parseInt($('#task-minutes').val())
        };

        $.ajax({
            url:         'tasks.php',
            method:      'POST',
            contentType: 'application/json',
            data:        JSON.stringify(newTask),
            success: function (task) {
                allTasks.push(task); // update local array 
                renderTasks();
                updateStats();
                $('#task-form')[0].reset();
                showNotif('Task added successfully', 'success');
            },
            error: function (xhr) {
                // PHP returns a 400 with an error message if validation fails
                const response = JSON.parse(xhr.responseText);
                showNotif(response.error, 'error');
            }
        });
    });

    // PUT — toggles a task between pending and done when the circle is clicked.
    // The event is on document because .task-check is created dynamically.
    $(document).on('click', '.task-check', function () {
        const id        = $(this).data('id');
        const task      = allTasks.find(t => t.id == id);
        const newStatus = task.status === 'pending' ? 'done' : 'pending';

        $.ajax({
            url:         'tasks.php',
            method:      'PUT',
            contentType: 'application/json',
            data:        JSON.stringify({ id: id, status: newStatus }),
            success: function () {
                task.status = newStatus; // update local array directly
                renderTasks();
                updateStats();
            }
        });
    });

    // DELETE — removes a task when the ✕ button is clicked.
    $(document).on('click', '.task-delete', function () {
        const id = $(this).data('id');

        $.ajax({
            url:         'tasks.php',
            method:      'DELETE',
            contentType: 'application/json',
            data:        JSON.stringify({ id: id }),
            success: function () {
                allTasks = allTasks.filter(t => t.id != id);
                renderTasks();
                updateStats();
            }
        });
    });


    // ── RENDERING AND STATS ──────────────────────────────────────────────────────────

    // Rebuilds the task list every time something changes.
    // Filters the array first, then injects the HTML into the DOM.
    function renderTasks() {
        const filtered = allTasks.filter(function (task) {
            if (currentFilter === 'pending') return task.status === 'pending';
            if (currentFilter === 'done')    return task.status === 'done';
            return true; // 'all'
        });

        $('#tasks-list').empty();

        if (filtered.length === 0) {
            $('#empty-state').removeClass('hidden');
        } else {
            $('#empty-state').addClass('hidden');

            filtered.forEach(function (task) {
                const done = task.status === 'done';

                // Template literal builds the HTML for each task row.
                const item = `
                    <li class="task-item" data-id="${task.id}">
                        <div class="task-check ${done ? 'done' : ''}"
                             data-id="${task.id}"></div>
                        <div class="task-info">
                            <div class="task-name ${done ? 'done' : ''}">
                                ${task.name}
                            </div>
                            <div class="task-sub">
                                ${task.subject} · ${task.minutes} min
                            </div>
                        </div>
                        <span class="task-tag ${done ? 'done' : 'pending'}">
                            ${done ? 'Done' : 'Pending'}
                        </span>
                        <button class="task-delete" data-id="${task.id}">✕</button>
                    </li>`;

                $('#tasks-list').append(item);
            });
        }

        updatePendingCount();
    }

    // Updates the three stat cards at the top.
    function updateStats() {
        const total   = allTasks.length;
        const done    = allTasks.filter(t => t.status === 'done').length;
        const minutes = allTasks.reduce((sum, t) => sum + t.minutes, 0);

        $('#stat-total').text(total);
        $('#stat-done').text(done);
        $('#stat-minutes').text(minutes + ' min');
    }

    // Shows how many tasks are still pending in the header and clears the text completely when everything is done.
    function updatePendingCount() {
        const pending = allTasks.filter(t => t.status === 'pending').length;
        $('#pending-count').text(pending > 0 ? pending + ' pending' : '');
    }

    // Filter buttons — update currentFilter and re-render the list.
    $('.filter-btn').on('click', function () {
        $('.filter-btn').removeClass('active');
        $(this).addClass('active');
        currentFilter = $(this).data('filter');
        renderTasks();
    });

    // ── POMODORO TIMER - WEBSOCKET ──────────────────────────────────────────────────────────
    
    let ws = null; // holds the WebSocket connection once established

    // Read the configured minutes from the inputs
    function getWorkMin()  { return parseInt($('#work-minutes').val())  || 25; }
    function getBreakMin() { return parseInt($('#break-minutes').val()) || 5;  }

    // Converts a number of seconds into mm:ss format
    function formatTime(secs) {
        const m = Math.floor(secs / 60).toString().padStart(2, '0');
        const s = (secs % 60).toString().padStart(2, '0');
        return m + ':' + s;
    }

    // Sets the display to the configured work time before the timer starts.
    function initTimer() {
        secondsLeft = getWorkMin() * 60;
        $('#timer-display').text(formatTime(secondsLeft));
    }

    // Opens the WebSocket connection to the PHP server.
    // If the connection fails, we fall back to a local setInterval timer.
    function connectWebSocket() {
        ws = new WebSocket('ws://127.0.0.1:8080');

        ws.onopen = function () {
            console.log('WebSocket connected');
        };

        // The server sends two types of messages: tick (every second) and finished (when a session ends).
        ws.onmessage = function (event) {
            const msg = JSON.parse(event.data);

            if (msg.type === 'tick') {
                secondsLeft = msg.seconds;
                $('#timer-display').text(formatTime(secondsLeft));

                // Accumulate stats depending on whether we're in work or break
                if (msg.isBreak) { totalBreakSecs += 1; }
                else             { totalWorkSecs  += 1; }
                updateSessionStats();

            } else if (msg.type === 'finished') {
                if (msg.mode === 'work') {
                    // Work session ended — switch to break
                    $('#timer-circle').removeClass('running').addClass('break-mode');
                    $('#timer-display').text(formatTime(getBreakMin() * 60));
                    $('#timer-status').text('Break session');
                    showNotif('Session complete! Take a break.', 'success');
                } else {
                    // Break ended — switch back to work
                    $('#timer-circle').removeClass('running break-mode');
                    $('#timer-display').text(formatTime(getWorkMin() * 60));
                    $('#timer-status').text('Work session');
                    showNotif('Break over! Back to work.', 'success');
                }
                isRunning = false;
                $('#btn-start').text('Start').removeClass('running');
            }
        };

        ws.onclose = function () {
            console.log('WebSocket disconnected');
        };

        ws.onerror = function () {
            console.log('WebSocket error — falling back to local timer');
            useLocalTimer();
        };
    }

    // Local timer fallback using setInterval in case the WebSocket server is not running. 
    function useLocalTimer() {
        if (!isRunning) return;
        timerInterval = setInterval(function () {
            secondsLeft--;
            $('#timer-display').text(formatTime(secondsLeft));
            if (isBreak) { totalBreakSecs++; } else { totalWorkSecs++; }
            updateSessionStats();
            if (secondsLeft <= 0) {
                clearInterval(timerInterval);
                onTimerFinished();
            }
        }, 1000);
    }

    // Handles what happens when either session reaches zero in local mode.
    function onTimerFinished() {
        $('#timer-circle').removeClass('running');
        if (!isBreak) {
            isBreak = true;
            secondsLeft = getBreakMin() * 60;
            $('#timer-circle').addClass('break-mode');
            $('#timer-status').text('Break session');
            showNotif('Session complete! Take a break.', 'success');
        } else {
            isBreak = false;
            secondsLeft = getWorkMin() * 60;
            $('#timer-circle').removeClass('break-mode');
            $('#timer-status').text('Work session');
            showNotif('Break over! Back to work.', 'success');
        }
        $('#timer-display').text(formatTime(secondsLeft));
        $('#btn-start').text('Start').removeClass('running');
    }

    // Updates the worked/rested counters below the timer buttons.
    function updateSessionStats() {
        $('#total-work').text(Math.floor(totalWorkSecs  / 60) + ' min');
        $('#total-break').text(Math.floor(totalBreakSecs / 60) + ' min');
    }

    // Start / Pause button — sends the action to the WebSocket server.
    // Falls back to useLocalTimer() if the connection is not open.
    $('#btn-start').on('click', function () {
        if (isRunning) {
            isRunning = false;
            clearInterval(timerInterval);
            $('#btn-start').text('Resume').removeClass('running');
            $('#timer-circle').removeClass('running');
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: 'pause' }));
            }
        } else {
            isRunning = true;
            $('#btn-start').text('Pause').addClass('running');
            $('#timer-circle').addClass('running');
            $('#notif').addClass('hidden');
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    action:   'start',
                    workMin:  getWorkMin(),
                    breakMin: getBreakMin()
                }));
            } else {
                useLocalTimer();
            }
        }
    });

    // Reset button — clears everything and goes back to the initial state.
    $('#btn-reset').on('click', function () {
        isRunning   = false;
        isBreak     = false;
        clearInterval(timerInterval);
        secondsLeft = getWorkMin() * 60;
        $('#timer-display').text(formatTime(secondsLeft));
        $('#btn-start').text('Start').removeClass('running');
        $('#timer-circle').removeClass('running finished break-mode');
        $('#timer-status').text('Work session');
        $('#notif').addClass('hidden');
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'reset' }));
        }
    });

    // Start the WebSocket connection and initialise the timer display.
    connectWebSocket();
    initTimer();

});