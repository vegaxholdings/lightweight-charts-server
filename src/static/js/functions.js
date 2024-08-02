class LoadingUI {
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
     * @param {HTMLElement} loc 
     */
    constructor(loc) {
        this.loc = loc;
        this.isOn = false;
    }

    on() {
        if (this.isOn) return;
        this.loc.innerHTML += LoadingUI.html;
        this.isOn = true;
    }

    off() {
        if (!this.isOn) return;
        this.loc.querySelector("#loading-ui").remove();
        this.isOn = false;
    }
}

/**
 * @param {HTMLFormElement} formElement 
 * @param {boolean} value
 */
const readonly = (formElement, value) => {
    formElement.querySelectorAll('input').forEach(input => {
        if (value === true) {
            input.setAttribute('readonly', true);
        } else {
            input.removeAttribute('readonly');
        }
    });
};

/**
 * @param {SubmitEvent} event 
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
    await request;
    readonly(formElement, false);
    submitButton.style.display = "flex";
    loading.off();
};

/**
 * @param {string} form 
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