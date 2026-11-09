# Wrap Studio

Tesla Paint Shop용 디지털 랩 편집기입니다. 차종과 트림을 선택한 뒤 파츠마다 색을 채우거나, 여러 파츠에 하나의 이미지를 걸쳐 배치할 수 있습니다. 전개도에서 가이드를 켜면 잘리는 이미지 영역을 옅게 보여 줍니다. 화면을 처음 열면 Model 3 Highland에 예제 이미지가 적용되어 있습니다. 새로 시작하려면 편집기 위쪽의 초기화 버튼을 누르세요.

## 로컬 실행

프로젝트 폴더에서 정적 서버를 실행한 뒤 브라우저에서 `http://localhost:8042`를 여세요.

```sh
python3 -m http.server 8042 --bind 127.0.0.1
```

별도 빌드나 API 키가 필요 없습니다. 차종을 처음 선택하면 브라우저가 Tesla 공식 저장소에서 해당 PNG 전개도를 가져옵니다.

## GitHub Pages

1. 이 프로젝트 파일을 GitHub 저장소의 `main` 브랜치에 커밋하고 푸시합니다.
2. GitHub 저장소의 **Settings → Pages**에서 **Deploy from a branch**를 선택합니다.
3. **main**과 **/ (root)**를 고르고 저장합니다. 배포가 끝나면 같은 화면에 사이트 주소가 표시됩니다.

## 편집과 내보내기

- 파츠 버튼이나 전개도 자체를 눌러 선택합니다. **전체 선택**을 다시 누르면 선택을 해제합니다.
- PNG, JPG, WebP를 올리고 이미지를 끌어 이동합니다. 크기와 회전 슬라이더도 사용할 수 있습니다. 색상 탭에서 선택한 파츠의 이미지를 단색으로 교체할 수 있습니다.
- 외부에서 직접 그리려면 **빈 도안 다운로드**로 차종별 공식 PNG를 받으세요. 캔버스 크기를 유지한 채 흰색 영역에 그리고, **작성한 도안 불러오기**로 같은 차종에 적용합니다. 불러온 도안이 전체 디자인을 교체하며, 실행 취소로 이전 작업을 복원할 수 있습니다.
- 상단 바의 **원본 배치**는 원본 비율을 유지하며 선택한 파츠 모양으로 이미지를 잘라냅니다. 처음 전환하면 회전 0°에서 시작합니다. **차량 맞춤**은 3D 프리뷰의 현재 각도에서 이미지를 투영합니다. Model 3 Highland, 기존 Model 3, Model Y Juniper에서는 보닛과 앞 범퍼를 함께 선택하면 차체 앞쪽 곡면을 따라 이미지를 연결합니다. 위치, 크기, 회전은 이미지의 배치 방식별로 저장됩니다. PNG는 현재 선택한 배치 방식을 따릅니다.
- 기존 Model 3, Model 3 Highland, 기존 Model Y, Model Y Juniper에 회전 가능한 3D 프리뷰를 제공합니다. 각 차종의 도색 면에는 Tesla 공식 전개도용 UV 좌표를 저장합니다. Highland와 Juniper는 같은 차체에 트림별 UV를 적용합니다. WebGL을 사용할 수 없거나 3D 프리뷰를 지원하지 않는 차종에는 전개도 프리뷰가 표시됩니다.
- **내 작업 → 새로 저장**에서 이름을 붙이면 차종, 색상, 이미지와 배치를 보관할 수 있습니다. 나중에 같은 사이트 주소를 같은 브라우저에서 열어 작업을 이어서 편집하세요. 사이트 데이터를 삭제하면 저장한 작업도 지워집니다.
- Cybertruck은 직사각형 빈 도안과 정사각형 PNG를 모두 불러올 수 있습니다. 저장할 때는 공식 예시와 같은 정사각형 PNG를 사용합니다. 다른 차종은 공식 전개도 비율로 저장합니다.
- PNG가 1 MB를 넘으면 해상도를 단계적으로 낮춥니다. 차량 전송은 Tesla 앱의 **Creations → Wrap → Upload** 또는 USB의 `Wraps` 폴더를 이용합니다. [Tesla 적용 안내](https://github.com/teslamotors/custom-wraps#how-to-use-custom-wraps)

## 출처

- 차종별 전개도와 차량 적용 규격은 [Tesla custom-wraps](https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce)를 사용합니다.
- 3D 메시 출처와 라이선스는 [모델 크레딧](assets/models/CREDITS.md)에 있습니다. 렌더링은 [Three.js](https://github.com/mrdoob/three.js)를 사용합니다.
- 편집 화면은 흰 바탕에 실버와 차콜을 사용합니다. 서체는 [Pretendard](https://github.com/orioncactus/pretendard)와 JetBrains Mono를 사용합니다.
