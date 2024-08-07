/**
 * Class representing a loading UI component.
 */
class LoadingUI {
    /**
     * HTML content for the loading UI.
     * @type {string}
     */
    static html = `
        <svg id="loading-ui" class="loader" viewBox="0 0 24 24">
            <circle class="loader__value" cx="12" cy="12" r="10" />
            <circle class="loader__value" cx="12" cy="12" r="10" />
            <circle class="loader__value" cx="12" cy="12" r="10" />
            <circle class="loader__value" cx="12" cy="12" r="10" />
            <circle class="loader__value" cx="12" cy="12" r="10" />
            <circle class="loader__value" cx="12" cy="12" r="10" />
        </svg>
    `;

    /**
     * Create a loading UI instance.
     * @param {HTMLElement} loc - The location to insert the loading UI.
     */
    constructor(loc) {
        /** @type {HTMLElement} */
        this.loc = loc;
        /** @type {boolean} */
        this.isOn = false;
    }

    /**
     * Turn on the loading UI.
     * Adds the loading UI HTML to the specified location.
     */
    on() {
        if (this.isOn) return;
        this.loc.insertAdjacentHTML('beforeend', LoadingUI.html);
        this.isOn = true;
    }

    /**
     * Turn off the loading UI.
     * Removes the loading UI HTML from the specified location.
     */
    off() {
        if (!this.isOn) return;
        const loadingElement = this.loc.querySelector("#loading-ui");
        if (loadingElement) loadingElement.remove();
        this.isOn = false;
    }
}

/**
 * Set or remove readonly attribute on input elements within a form.
 * @param {HTMLFormElement} formElement - The form element containing the inputs.
 * @param {boolean} value - True to set readonly, false to remove it.
 */
const readonly = (formElement, value) => {
    formElement.querySelectorAll('input').forEach(input => {
        input.toggleAttribute('readonly', value);
    });
};

/**
 * Handle form submission.
 * Prevents default submission, shows loading UI, sends data to server, then hides loading UI.
 * @param {SubmitEvent} event - The form submit event.
 */
const submit = async (event) => {
    event.preventDefault();
    const formElement = event.target;
    const formData = new FormData(formElement);
    const data = Object.fromEntries(formData.entries());
    const request = fetch(window.location.origin + '/parameter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });

    const submitDiv = formElement.querySelector(".submit");
    const submitButton = submitDiv.querySelector("button");

    const loading = new LoadingUI(submitDiv);
    submitButton.style.display = "none";
    loading.on();
    readonly(formElement, true);

    const response = await request;
    if (response.status !== 200) {
        alert("An error occurred on the server! Check the server log");
    }

    readonly(formElement, false);
    submitButton.style.display = "flex";
    loading.off();

    location.reload();
};

/**
 * Create a custom parameter section from a form HTML string.
 * @param {string} form - The HTML string representing the form.
 */
const createCustomParameterSection = (form) => {
    const dom = (new DOMParser()).parseFromString(form, 'text/html');
    const formElement = dom.body.firstElementChild;
    const section = document.createElement('section');
    const button = document.createElement('button');
    const toggleImg = document.createElement('img');

    section.id = "custom-parameter";
    toggleImg.src = "/static/asset/arrow.png";
    toggleImg.style.width = "20px";
    toggleImg.style.height = "10px";

    section.appendChild(formElement);
    section.appendChild(button);
    button.appendChild(toggleImg);

    button.addEventListener("click", () => {
        section.classList.toggle('toggled');
    });

    document.body.appendChild(section);

    formElement.addEventListener("submit", submit);
};

websocket = new WebSocket(`ws://${location.host}/ws`);
websocket.onopen = (event) => console.log("open",event)
websocket.onmessage = (event) => {
    console.log(event)
    eval(event.data)
}
websocket.onclose = (event) => console.log("close",event)