"use strict";

const settings = window.RB_CONFIG;

const isConfigured = Boolean(
  settings &&
  settings.supabaseUrl.startsWith("https://") &&
  !settings.supabaseUrl.includes("PASTE_") &&
  !settings.supabasePublicKey.includes("PASTE_") &&
  !settings.ownerId.includes("PASTE_")
);

let database = null;

if (isConfigured && window.supabase) {
  database = window.supabase.createClient(
    settings.supabaseUrl,
    settings.supabasePublicKey,
    {
      auth: {
        // Owner login lasts for this browser tab.
        storage: window.sessionStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    }
  );
}

function setStatus(element, message, type = "") {
  element.textContent = message;
  element.classList.remove("status-error", "status-success");

  if (type) {
    element.classList.add(`status-${type}`);
  }
}


/* ========================================
   PLAYER INPUTS
   ======================================== */

const playerFields = document.getElementById("player-fields");

if (playerFields) {
  for (let number = 1; number <= 4; number++) {
    const fieldset = document.createElement("fieldset");

    fieldset.className = "player-card";

    fieldset.innerHTML = `
      <legend>PLAYER ${number}</legend>

      <div class="player-grid">
        <label for="player-${number}-name">
          Player name
          <input
            id="player-${number}-name"
            name="player_${number}_name"
            maxlength="60"
            placeholder="Player name"
            required
          >
        </label>

        <label for="player-${number}-ign">
          FF ID name / in-game name
          <input
            id="player-${number}-ign"
            name="player_${number}_ign"
            maxlength="60"
            placeholder="Exact in-game name"
            required
          >
        </label>

        <label for="player-${number}-uid">
          Numeric FF UID
          <input
            id="player-${number}-uid"
            name="player_${number}_uid"
            inputmode="numeric"
            pattern="[0-9]{5,20}"
            maxlength="20"
            placeholder="Numeric player UID"
            required
          >
        </label>
      </div>
    `;

    playerFields.appendChild(fieldset);
  }
}


/* ========================================
   REGISTRATION
   ======================================== */

const registrationForm = document.getElementById(
  "registration-form"
);

if (registrationForm) {
  const button = document.getElementById("register-button");
  const notice = document.getElementById("registration-notice");
  const status = document.getElementById("registration-status");

  const canRegister = Boolean(
    database && settings.registrationOpen
  );

  button.disabled = !canRegister;

  if (!database) {
    notice.textContent =
      "Website preview: database connection is not configured yet.";
    button.textContent = "Database setup required";
  } else if (settings.registrationOpen) {
    notice.hidden = true;
    button.textContent = "Submit registration ↗";
  }

  registrationForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!canRegister || !registrationForm.reportValidity()) {
      return;
    }

    const form = new FormData(registrationForm);

    function value(name) {
      return String(form.get(name) || "").trim();
    }

    const players = [];

    for (let number = 1; number <= 4; number++) {
      players.push({
        name: value(`player_${number}_name`),
        ign: value(`player_${number}_ign`),
        uid: value(`player_${number}_uid`)
      });
    }

    if (new Set(players.map((player) => player.uid)).size !== 4) {
      setStatus(
        status,
        "Each player must have a different FF UID.",
        "error"
      );
      return;
    }

    const phone = value("igl_phone");
    const phoneDigits = phone.replace(/\D/g, "");

    if (
      !/^\+?[0-9 ()-]+$/.test(phone) ||
      phoneDigits.length < 7 ||
      phoneDigits.length > 15
    ) {
      setStatus(
        status,
        "Enter a valid IGL phone number.",
        "error"
      );
      return;
    }

    // Generate the reference before inserting.
    // No public database read is needed to return it.
    const reference = crypto.randomUUID();

    button.disabled = true;
    button.textContent = "Saving registration…";

    setStatus(status, "Please wait while your details are saved.");

    try {
      const { error } = await database
        .from("rb_teams")
        .insert({
          reference,
          team_name: value("team_name"),
          players,
          igl_name: value("igl_name"),
          igl_ign: value("igl_ign"),
          igl_uid: value("igl_uid"),
          igl_phone: phone,
          igl_email: value("igl_email"),
          consent: true
        });

      if (error) {
        if (error.code === "23505") {
          throw new Error(
            "This team name or IGL UID is already registered. " +
            "Contact the organizer for changes."
          );
        }

        if (error.code === "42501") {
          throw new Error(
            "Registration is closed or database permissions " +
            "are not configured. Contact the organizer."
          );
        }

        throw new Error(
          "Could not confirm the save. Contact the organizer " +
          "before submitting again. Reference: " + reference
        );
      }

      registrationForm.reset();

      setStatus(
        status,
        "Registration saved!\n" +
        "Reference: " + reference + "\n" +
        "Payment and slot confirmation are pending.",
        "success"
      );
    } catch (error) {
      setStatus(
        status,
        error.message ||
          "Connection failed. Contact the organizer before retrying.",
        "error"
      );
    } finally {
      button.disabled = false;
      button.textContent = "Submit registration ↗";
    }
  });
}


/* ========================================
   OWNER DASHBOARD
   ======================================== */

const loginForm = document.getElementById("login-form");

if (loginForm) {
  const loginPanel = document.getElementById("login-panel");
  const dashboard = document.getElementById("dashboard");
  const status = document.getElementById("admin-status");
  const teamsList = document.getElementById("teams-list");
  const count = document.getElementById("team-count");
  const search = document.getElementById("team-search");

  let requestVersion = 0;

  function showLogin() {
    requestVersion++;
    teamsList.replaceChildren();
    dashboard.hidden = true;
    loginPanel.hidden = false;
    count.textContent = "";
    search.value = "";
  }

  // Database values are added as text, not executable HTML.
  function addText(parent, tag, text, className = "") {
    const element = document.createElement(tag);
    element.textContent = text;

    if (className) {
      element.className = className;
    }

    parent.appendChild(element);
    return element;
  }

  function renderTeam(team) {
    const card = document.createElement("article");
    card.className = "panel team-card";

    const heading = document.createElement("div");
    heading.className = "team-heading";

    addText(heading, "h2", team.team_name);
    addText(heading, "span", team.reference, "reference");
    card.appendChild(heading);

    addText(
      card,
      "p",
      "Submitted: " + new Date(team.created_at).toLocaleString(),
      "muted"
    );

    const details = document.createElement("div");
    details.className = "owner-details";

    const fields = [
      ["IGL name", team.igl_name],
      ["IGL FF ID name", team.igl_ign],
      ["IGL UID", team.igl_uid],
      ["IGL phone", team.igl_phone],
      ["IGL email", team.igl_email]
    ];

    fields.forEach(([label, value]) => {
      const paragraph = document.createElement("p");

      addText(paragraph, "span", label);
      paragraph.appendChild(document.createTextNode(value));

      details.appendChild(paragraph);
    });

    card.appendChild(details);

    addText(card, "h3", "Player lineup");

    const scroll = document.createElement("div");
    scroll.className = "table-scroll";

    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");

    ["Player", "FF ID name", "FF UID"].forEach((label) => {
      addText(headRow, "th", label);
    });

    head.appendChild(headRow);
    table.appendChild(head);

    const body = document.createElement("tbody");

    team.players.forEach((player) => {
      const row = document.createElement("tr");

      addText(row, "td", player.name);
      addText(row, "td", player.ign);
      addText(row, "td", player.uid);

      body.appendChild(row);
    });

    table.appendChild(body);
    scroll.appendChild(table);
    card.appendChild(scroll);

    return card;
  }

  async function loadTeams() {
    const version = ++requestVersion;

    teamsList.replaceChildren();
    setStatus(status, "Loading registrations…");

    try {
      // Verify the current account with the auth service.
      const { data: authData, error: authError } =
        await database.auth.getUser();

      if (version !== requestVersion) return;

      if (
        authError ||
        !authData.user ||
        authData.user.id !== settings.ownerId
      ) {
        showLogin();

        setStatus(
          status,
          "Please sign in with the owner account.",
          "error"
        );
        return;
      }

      // Fetch in pages rather than silently stopping at 1,000 rows.
      const allTeams = [];
      const pageSize = 500;
      let offset = 0;

      while (true) {
        const { data, error } = await database
          .from("rb_teams")
          .select("*")
          .order("created_at", { ascending: false })
          .order("reference", { ascending: true })
          .range(offset, offset + pageSize - 1);

        if (error) {
          throw new Error("Could not load registrations.");
        }

        if (version !== requestVersion) return;

        allTeams.push(...data);

        if (data.length < pageSize) break;

        offset += pageSize;
      }

      if (version !== requestVersion) return;

      loginPanel.hidden = true;
      dashboard.hidden = false;

      count.textContent = `${allTeams.length} team(s) registered.`;

      if (!allTeams.length) {
        addText(
          teamsList,
          "p",
          "No registrations yet.",
          "notice"
        );
      } else {
        allTeams.forEach((team) => {
          teamsList.appendChild(renderTeam(team));
        });
      }

      applySearch();
      setStatus(status, "");
    } catch (error) {
      setStatus(status, error.message, "error");
    }
  }

  function applySearch() {
    const query = search.value.trim().toLowerCase();

    teamsList.querySelectorAll(".team-card").forEach((card) => {
      card.hidden = !card.textContent.toLowerCase().includes(query);
    });
  }

  search.addEventListener("input", applySearch);

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!database) {
      setStatus(
        status,
        "Complete the database settings in config.js first.",
        "error"
      );
      return;
    }

    const button = loginForm.querySelector("button");
    button.disabled = true;

    setStatus(status, "Checking your login…");

    try {
      const { data, error } = await database.auth.signInWithPassword({
        email: document.getElementById("owner-email").value.trim(),
        password: document.getElementById("owner-password").value
      });

      if (error || !data.user) {
        throw new Error("Could not sign in. Check your email and password.");
      }

      if (data.user.id !== settings.ownerId) {
        await database.auth.signOut();

        throw new Error("This account is not the tournament owner.");
      }

      loginForm.reset();
      await loadTeams();
    } catch (error) {
      setStatus(status, error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("refresh-button")
    .addEventListener("click", loadTeams);

  document.getElementById("logout-button")
    .addEventListener("click", async () => {
      showLogin();

      const { error } = await database.auth.signOut();

      setStatus(
        status,
        error
          ? "Logout could not be confirmed. Close this tab."
          : "Logged out.",
        error ? "error" : ""
      );
    });

  if (!database) {
    setStatus(
      status,
      "Preview mode: complete config.js to enable owner login."
    );
  } else {
    database.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        showLogin();
      }
    });

    loadTeams();
  }
}