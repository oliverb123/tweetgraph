flags = --bind \
		-s USE_PTHREADS=1 \
		-s PTHREAD_POOL_SIZE=5 \
		-s WASM=1 \
		-s NO_EXIT_RUNTIME=1 \
		-s INITIAL_MEMORY=256MB \
		-s "EXTRA_EXPORTED_RUNTIME_METHODS=['ccall', 'getValue', 'setValue']"

main: main.cpp primitives.hpp quadTree.hpp layout.hpp
	em++ -O3 $(flags) main.cpp -o tweetGraphEngine.js

debug: main.cpp primitives.hpp quadTree.hpp layout.hpp
	em++ -O0 -g4  $(flags) main.cpp -o tweetGraphEngine.js --source-map-base /


run: *
	emrun --no_browser --port 8080 .

deploy: main.cpp primitives.hpp quadTree.hpp layout.hpp
	cp -f tweetGraphEngine.* ../published/
	cp -f tweetGraph.html ../published/
	cp -f tweetGraphAbout.html ../published/
	cp -f tweetGraphSrc.js ../published/
	cp -f vivagraph.min.js ../published/
	cp -f WASMLayoutInterface.js ../published/