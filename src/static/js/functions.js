// JS 함수를 직접 정의합니다.
// 함수는 inject_js를 통해 사용됩니다.

/**
 * 
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
};