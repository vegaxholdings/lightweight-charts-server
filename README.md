> 초안입니다.

### 샘플 실행해보기

```
python setting_data.py

python line_indicators.py

python styling.py
```

### Development convention

- 브랜치
    - release: 절대 오류나면 안되는, pypi에 배포되는 소스코드 (CI/CD 파이프라인에 연동됨)
    - main: 오류 나면 안되는 git clone 대상 브랜치
    - dev: 오류 나도 상관 없는 개발 브랜치

- 의존성: pyproject.toml에서 project 섹션의 dependencies 리스트 인스톨하면 됨